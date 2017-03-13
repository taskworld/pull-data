'use strict'

const P = require('bluebird')
const Moment = require('moment')
const Mongo = require('./mongodb')
const Util = require('./util')
const Fs = require('fs')
P.promisifyAll(Fs)

const MAX_DOCS = 10000

P.coroutine(run)(require('minimist')(process.argv.slice(2)))

function * run (args) {
  if (!args.from || !args.to) {
    console.log(`
    Usage: node fetch-tw-transactions.js
      --from    From date, e.g. 2016-07-01
      --to      To date, e.g. 2016-07-31
    `)
    return
  }

  const startDate = Moment(args.from)
  const endDate = Moment(args.to)

  console.log(`
  Pulling transactions for period:
  Start Date: ${startDate.format()}
  End Date:   ${endDate.format()}
  `)

  const history = yield Mongo.query(getTransactionHistory, { startDate, endDate })

  const reportFileName = `/tmp/tw-transaction-log.json`
  yield Fs.writeFileAsync(reportFileName, JSON.stringify(history, null, 2))

  Mongo.close()
}

function * getTransactionHistory (db, opts) {
  const $match = {
    action: 'subscription_charged_successfully',
    workspace_id: { $exists: true }
  }
  const $project = {
    workspace_id: 1,
    created: 1,
    _id: 1,
    transaction_amount: 1,
    membership: 1,
    billingPeriodStartDate: '$raw_response.subject.subscription.billingPeriodStartDate',
    nextBillingDate: '$raw_response.subject.subscription.nextBillingDate',
    currentBillingCycle: '$raw_response.subject.subscription.currentBillingCycle',
    planId: '$raw_response.subject.subscription.planId'
  }
  const $sort1 = { created: 1 }
  const $sort2 = { created: -1 }
  const $group = {
    _id: '$workspace_id',
    created: { $max: '$created' },
    transactions: {
      $push: {
        amount: '$transaction_amount',
        date: '$created',
        licenses: '$membership.user_limit',
        billingPeriodStartDate: '$billingPeriodStartDate',
        nextBillingDate: '$nextBillingDate',
        currentBillingCycle: '$currentBillingCycle',
        planId: '$planId'
      }
    }
  }

  return yield db.collection('transaction_logs')
  .aggregate([
    { $match },
    { $project },
    { $sort: $sort1 },
    { $group },
    { $sort: $sort2 }
  ])
  .toArray()
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

  const reportFileName = '/tmp/tw-transaction-log.json'
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
