'use strict'

const P = require('bluebird')
const Moment = require('moment')
const Mongo = require('./mongodb')
const Util = require('./util')
const Fs = require('fs')
P.promisifyAll(Fs)

const MAX_DOCS = 10000

const Argv = require('minimist')(process.argv.slice(2))
if (Argv.from && Argv.to) {
  run(Argv)
} else {
  console.log(`
  Usage: node fetch-tw-data.js
    --from      From date, e.g. 2016-07-01
    --to        To date, e.g. 2016-07-31
  `)
}

function run (args) {
  pullDataFromMongoDb(
    Moment(args.from),
    Moment(args.to)
  )
}

function pullDataFromMongoDb (startDate, endDate) {
  console.log(`
  Pulling data for period:
  Start Date: ${startDate.format()}
  End Date:   ${endDate.format()}
  `)

  return Mongo.query(exportMemberships, { startDate, endDate })
  // .then(() => Mongo.query(exportTransactionLog, { startDate, endDate }))
  .then(Mongo.close)
  .catch((err) => console.error(err))
}

const _blacklistedEmails = [
  '@mailinator.com',
  '@mouawad.com',
  '@taskworld.com',
  '@synovafoods.com',
  'dadademau@gmail.com'
]
const _blacklistedEmailsRegexp = new RegExp(
  '(' + _blacklistedEmails.join('|') + ')$', 'i'
)
function isBlacklistedEmailAddress (email) {
  return _blacklistedEmailsRegexp.test(email)
}

function * getTransactionHistory (db, opts) {
  const $match = {
    action: 'subscription_charged_successfully',
    workspace_id: { $exists: true }
  }
  const $project = { workspace_id: 1, created: 1, _id: 1, transaction_amount: 1 }

  const $sort1 = { created: 1 }
  const $sort2 = { created: -1 }

  const $group = {
    _id: '$workspace_id',
    created: { $max: '$created' },
    transactions: {
      $push: {
        amount: '$transaction_amount',
        date: '$created'
      }
    }
  }

  const res = yield db.collection('transaction_logs')
  .aggregate([
    { $match },
    { $project },
    { $sort: $sort1 },
    { $group },
    { $sort: $sort2 }
  ]).toArray()

  const history = res.reduce((acc, x) => {
    acc[x._id.toString()] = x
    return acc
  }, { })

  return history
}

function * exportTransactionLog (db, opts) {
  const dateRange =
    opts.startDate.format('YYYY-MM-DD') + '-' +
    opts.endDate.format('YYYY-MM-DD')

  console.log(`Exporting Taskworld data for period ${dateRange} ..`)

  // Fetch all transaction log entires.
  const txns = yield db.collection('transaction_logs')
  .find({
    success: true,
    'raw_response.kind': {
      $in: ['subscription_canceled', 'subscription_charged_successfully']
    },
    created: {
      $gte: opts.startDate.toDate(),
      $lt: opts.endDate.toDate()
    }
  })
  .sort({ _id: -1 })
  .limit(MAX_DOCS)
  .toArray()
  console.log(`Found ${txns.length} transaction log entries.`)

  const txnsMap = getTransactionsByWorkspace(txns)

  const reportFileName = `/tmp/tw-transaction-log.json`
  yield Fs.writeFileAsync(reportFileName, JSON.stringify(txnsMap, null, 2))
}

function getTransactionsByWorkspace (txns) {
  return txns.reduce((acc, x) => {
    const workspaceId = x.workspace_id
    if (!acc[workspaceId]) {
      const sub = x.raw_response.subscription
      acc[workspaceId] = {
        subscriptionId: x.subscription_id,
        kind: x.raw_response.kind,
        planId: sub.planId,
        billingPeriodStartDate: sub.billingPeriodStartDate,
        billingPeriodEndDate: sub.billingPeriodEndDate,
        transactions: sub.transactions.map(y => ({
          amount: y.amount,
          createdAt: y.createdAt,
          currency: y.currencyIsoCode,
          status: y.status,
          email: y.customer.email,
          type: y.paymentInstrumentType,
          creditCard: y.creditCard.expirationMonth + '/' + y.creditCard.expirationYear
        }))
      }
    }
    return acc
  }, { })
}

function * exportMemberships (db, opts) {
  const dateRange =
    opts.startDate.format('YYYY-MM-DD') + '-' +
    opts.endDate.format('YYYY-MM-DD')

  console.log(`Exporting Taskworld data for period ${dateRange} ..`)

  // Fetch all memberships.
  const memberships = yield db.collection('memberships')
  .find({
    membership_type: { $ne: 'free_trial' },
    start_date: {
      $gte: opts.startDate.toDate(),
      $lt: opts.endDate.toDate()
    }
  })
  .sort({ _id: -1 })
  .limit(MAX_DOCS)
  .toArray()
  console.log(`Found ${memberships.length} memberships.`)

  const txnHistory = yield * getTransactionHistory(db, opts)

  const membershipIds = memberships.map((x) => x._id.toString())

  const membershipMap = memberships.reduce((acc, x) => {
    acc[x._id.toString()] = x
    return acc
  }, { })

  // Fetch all related workspaces.
  const workspaces = yield db.collection('workspaces')
  .find({ membership_id: { $in: membershipIds } })
  .sort({ _id: -1 })
  .limit(MAX_DOCS)
  .toArray()
  console.log(`Found ${workspaces.length} workspaces.`)

  // Extract all members.
  const membersTmp = workspaces.reduce((acc, x) => {
    acc.push(...(x.admins || []), x.owner_id)
    return acc
  }, [])

  const members = [ ...new Set(membersTmp) ]

  const memberIds = members
  .filter((x) => x && x.length === 24)
  .map((x) => Mongo.getObjectId(x))

  // Fetch all related users.
  const users = yield db.collection('users')
  .find({
    _id: { $in: memberIds },
    email: { $ne: 'system@taskworld.com' }
  })
  .project({ email: 1, time_zone: 1, last_name: 1, first_name: 1 })
  .sort({ _id: -1 })
  .toArray()

  const userMap = users.reduce((acc, x) => {
    acc[x._id.toString()] = x
    return acc
  }, { })

  const report = workspaces.map((x) => {
    if (x.membership_id) {
      const m = membershipMap[x.membership_id]
      const owner = userMap[x.owner_id]
      if (!owner) {
        console.error('Unknown workspace owner:', x.owner_id)
        return false
      }
      if (isBlacklistedEmailAddress(owner.email)) {
        console.error('Blacklisted owner email address:', owner.email)
        return false
      }

      const workspaceId = x._id.toString()
      const history = txnHistory[workspaceId]
      let latestAmount = m.price
      let previousAmount = 0
      if (history && history.transactions && history.transactions.length) {
        const l = history.transactions.length
        latestAmount = history.transactions[l - 1].amount
        if (l > 1) {
          previousAmount = history.transactions[l - 2].amount
        }
      }

      return {
        workspaceId: workspaceId,
        workspaceName: x.name,
        workspaceDisplayName: x.display_name,
        workspaceCreatedDate: Moment(x.created).format(),
        ownerName: `${owner.first_name} ${owner.last_name}`,
        ownerEmail: owner.email,
        subscription: m.membership_type,
        subscriptionId: m.subscription_id,
        paymentType: m.payment_account && m.payment_account.payment_type || null,
        membershipStartDate: Moment(m.start_date).format(),
        subscriptionStartDate: Moment(m.start_subscription_date || m.start_date).format(),
        subscriptionEndDate: Moment(m.expiry_date).format(),
        licenses: m.user_limit,
        billingCycle: m.billing_cycle_type,
        amount: latestAmount,
        currentPrice: m.price,
        previousAmount
      }
    }
    return false
  })
  .filter((x) => x)

  report.sort((a, b) => {
    return a.subscriptionStartDate > b.subscriptionStartDate ? -1 : 1
  })

  // console.log(userMap)
  // console.log(report)
  const reportFileName = `/tmp/tw-data.csv`
  console.log(`Creating ${reportFileName} with ${report.length} rows ..`)

  // Dump to CSV.
  yield Util.writeCsv(report, reportFileName)
}
