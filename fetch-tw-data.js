'use strict'

const P = require('bluebird')
const _ = require('lodash')
const Moment = require('moment')
const Mongo = require('./mongodb')
const Util = require('./util')
const Fs = require('fs')
const { serversList } = require('./serverlist')
const { sendEmail } = require('./lib/sendgrid')
const { TaskworldService } = require('./TaskworldService/taskworldService')
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

async function run (args) {
  try {
    await pullDataFromMongoDb(
      Moment(args.from),
      Moment(args.to)
    )
    process.exit(0)
  } catch (err) {
    return sendEmail({
      from: 'reports@taskworld.com',
      to: 'chakrit@taskworld.com',
      subject: `ERROR!!!: Marketing dashboard cannot reiterate data`,
      body: 'Error:' + err.message
    })
  }
}

async function pullDataFromMongoDb (startDate, endDate) {
  console.log(`
  Pulling data for period:
  Start Date: ${startDate.format()}
  End Date:   ${endDate.format()}
  `)

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

function isDedicatedWorkspace (workspace) {
  if (!workspace) return false
  return workspace.name.startsWith('dedicated_server_')
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
  const users = await TaskworldService.fetchUsersByIds(db, memberIds)

  const userMap = users.reduce((acc, x) => {
    acc[x._id.toString()] = x
    return acc
  }, { })

  const report = workspaces.map((workspace) => {
    if (workspace.membership_id) {
      const membership = membershipMap[workspace.membership_id]
      const owner = userMap[workspace.owner_id]
      if (!owner) {
        console.error('Unknown workspace owner:', workspace.owner_id)
        return false
      }
      if (owner.email === 'system@taskworld.com' && !isDedicatedWorkspace(workspace)) {
        return false
      }
      if (isBlacklistedEmailAddress(owner.email)) {
        console.error('Blacklisted owner email address:', owner.email)
        return false
      }

      const workspaceId = workspace._id.toString()

      return {
        workspaceId: workspaceId,
        workspaceName: workspace.name,
        workspaceDisplayName: workspace.display_name,
        workspaceCreatedDate: Moment(workspace.created).format(),
        ownerName: `${owner.first_name} ${owner.last_name}`,
        ownerEmail: owner.email,
        subscription: membership.membership_type,
        subscriptionId: membership.subscription_id,
        paymentType: (membership.payment_account && membership.payment_account.payment_type) || null,
        subscriptionStartDate: Moment(membership.start_subscription_date || membership.start_date).format(),
        membershipStartDate: Moment(membership.start_date).format(),
        subscriptionEndDate: Moment(membership.expiry_date).format(),
        licenses: membership.user_limit,
        billingCycle: membership.billing_cycle_type,
        amount: membership.cycle_charges.normal,
        upgraded: membership.cycle_charges.upgraded,
        refunded: membership.cycle_charges.refunded,
        currentPrice: membership.price,
        serverName,
        signupCountry: workspace.country || owner.country,
        utmSource: _.get(owner, 'metadata.signupMetadata.utm_source', ''),
        utmMedium: _.get(owner, 'metadata.signupMetadata.utm_medium', ''),
        utmKeyword: _.get(owner, 'metadata.signupMetadata.utm_keyword', ''),
        timezone: owner.time_zone,
        metadata: _.get(owner, 'metadata', null)
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
  console.log('Done')
}
