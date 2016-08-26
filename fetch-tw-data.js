'use strict'

const Moment = require('moment')
const Mongo = require('./mongodb')
const Util = require('./util')

const MAX_DOCS = 5000

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
    Moment(args.from).toDate(),
    Moment(args.to).toDate()
  )
}

function pullDataFromMongoDb (startDate, endDate) {
  console.log(`
  Pulling membership data:
  Start Date: ${startDate}
  End Date:   ${endDate}
  `)

  return Mongo.query(exportMemberships, {
    startDate,
    endDate
  })
  .then(Mongo.close)
  .catch((err) => console.error(err))
}

function * exportMemberships (db, opts) {
  console.log('Exporting ..')

  // Fetch all memberships.
  const memberships = yield db.collection('memberships')
  .find({ start_date: { $gte: opts.startDate, $lt: opts.endDate } })
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
  const workspaces = yield db.collection('workspaces')
  .find({ membership_id: { $in: membershipIds } })
  .sort({ _id: -1 })
  .limit(MAX_DOCS)
  .toArray()
  console.log(`Found ${workspaces.length} workspaces.`)

  // Extract all members.
  const membersTmp = workspaces.reduce((acc, x) => {
    acc.push(...x.admins, x.owner_id)
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

      return {
        workspaceName: x.name,
        workspaceDisplayName: x.display_name,
        ownerName: `${owner.first_name} ${owner.first_name}`,
        ownerEmail: owner.email,
        subscription: m.membership_type,
        paymentType: m.payment_account && m.payment_account.payment_type || null,
        subscriptionStartDate: m.start_subscription_date,
        subscriptionEndDate: m.expiry_date,
        licenses: m.user_limit,
        billingCycle: m.billing_cycle_type
      }
    }
    return false
  })
  .filter((x) => x)

  // console.log(userMap)
  // console.log(report)
  console.log(`Created a report with ${report.length} rows.`)

  // Dump to CSV.
  yield Util.writeCsv(report, '/tmp/tw-data.csv')
}
