'use strict'

const P = require('bluebird')
const Moment = require('moment')
const Mongo = require('./mongodb')
const Util = require('./util')
const Fs = require('fs')
const Assert = require('assert')
P.promisifyAll(Fs)

const MAX_DOCS = 10000

Assert(process.env.PULLDATA_MONGODB_URLS, 'Missing env `PULLDATA_MONGO_DB_URLS`')
Assert(process.env.PULLDATA_SERVERS_LIST, 'Missing env `PULLDATA_SERVERS_LIST`')

const dbUrls = process.env.PULLDATA_MONGO_DB_URLS.split(';')
const servers = process.env.PULLDATA_SERVERS_LIST.split(';')

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

async function pullDataFromMongoDb (startDate, endDate) {
  console.log(`
  Pulling data for period:
  Start Date: ${startDate.format()}
  End Date:   ${endDate.format()}
  `)
  const serversList = dbUrls.map((url, index) => (
    { dbUrl: url, serverName: servers[index] || 'Unknown server?' }
  ))
  const reports = await P.mapSeries(serversList, async server => {
    const db = await Mongo.connect(server.dbUrl)
    return fetchReport(db, { startDate, endDate, serverName: server.serverName })
  })
  const allReports = reports.reduce((acc, val) => [ ...acc, ...val ], [ ])
  allReports.sort((a, b) => {
    return a.subscriptionStartDate > b.subscriptionStartDate ? -1 : 1
  })
  await writeReportToCsv(allReports)
}

const _blacklistedEmails = [
  '@mailinator.com',
  'dadademau@gmail.com'
]
const _blacklistedEmailsRegexp = new RegExp(
  '(' + _blacklistedEmails.join('|') + ')$', 'i'
)
function isBlacklistedEmailAddress (email) {
  return _blacklistedEmailsRegexp.test(email)
}

async function fetchReport (db, opts) {
  const { serverName } = opts
  const dateRange =
  opts.startDate.format('YYYY-MM-DD') + '-' +
  opts.endDate.format('YYYY-MM-DD')

  console.log(`Exporting Taskworld data for period ${dateRange} ..`)

  // Fetch all memberships.
  const memberships = await db.collection('memberships')
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

  const membershipIds = memberships.map((x) => x._id.toString())
  const membershipMap = memberships.reduce((acc, x) => {
    acc[x._id.toString()] = x
    return acc
  }, { })

  // Fetch all related workspaces.
  const workspaces = await db.collection('workspaces')
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
  const users = await db.collection('users')
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
        subscriptionStartDate: Moment(m.start_subscription_date || m.start_date).format(),
        membershipStartDate: Moment(m.start_date).format(),
        subscriptionEndDate: Moment(m.expiry_date).format(),
        licenses: m.user_limit,
        billingCycle: m.billing_cycle_type,
        amount: m.cycle_charges.normal,
        upgraded: m.cycle_charges.upgraded,
        refunded: m.cycle_charges.refunded,
        currentPrice: m.price,
        serverName
      }
    }
    return false
  })
  .filter((x) => x)
  return report
}

async function writeReportToCsv (report) {
  const reportFileName = `/tmp/tw-data.csv`
  console.log(`Creating ${reportFileName} with ${report.length} rows ..`)

  // Dump to CSV.
  await Util.writeCsv(report, reportFileName)
}
