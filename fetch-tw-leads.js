'use strict'

const P = require('bluebird')
const Moment = require('moment')
const Mongo = require('./mongodb')
const Util = require('./util')
const Fs = require('fs')
const Sendgrid = require('./lib/sendgrid')

P.promisifyAll(Fs)
const MAX_DOCS = 50000
const tzToCountry = require('moment-timezone/data/meta/latest.json')

// console.log(tzToCountry.zones['Asia/Tokyo'].countries)
run()

function run () {
  const args = require('minimist')(process.argv.slice(2))

  if (args.leads) {
    return fetchLeads(args)
  }

  console.log(`
  Usage: node fetch-tw-leads.js
    --leads           Export leads
      [--country]     One or more country codes, e.g DE,SE,KR
      [--from]        From date, e.g. 2016-07-01
      [--to]          To date, e.g. 2016-07-31
  `)
}

function * sendLeads (csvFile) {
  const response = yield Sendgrid.sendEmail({
    from: 'reports@taskworld.com',
    to: 'nima.d@taskworld.com',
    subject: `Taskworld Leads CSV ${Moment().format('YYYY-MM-DD')}`,
    body: 'FYI. Leads!',
    files: [
      { path: csvFile, mime: 'text/plain' }
    ]
  })

  // Truncate if the send went well.
  if (response.statusCode !== 202) {
    console.log('Sendgrid gave unexpected response:', response)
  }
}

function fetchLeads ({ country, from, to }) {
  const countries = (country || '').trim().split(/\s*,\s*/)
  const startDate = from ? Moment(from, 'YYYY-MM-DD') : Moment().subtract(1, 'day').startOf('day')
  const endDate = to ? Moment(to, 'YYYY-MM-DD') : Moment().subtract(1, 'day').endOf('day')
  console.log(`
  Fetching leads:
  Countries:        ${countries.join(', ')}
  Membership range: ${startDate.format()} - ${endDate.format()}
  `)
  return dbRun(exportLeads, {
    countries,
    startDate,
    endDate
  })
}

function * exportLeads (db, opts) {
  // Fetch all trial memberships.
  const memberships = yield db.collection('memberships')
  .find({
    membership_type: 'free_trial',
    start_date: {
      $gte: opts.startDate.toDate(),
      $lt: opts.endDate.toDate()
    }
  })
  .sort({ _id: -1 })
  .limit(MAX_DOCS)
  .toArray()
  console.log(`Found ${memberships.length} memberships.`)

  // Extract memberships ids.
  const membershipIds = memberships.map((x) => x._id.toString())
  const membershipMap = memberships.reduce((acc, x) => {
    acc[x._id.toString()] = x
    return acc
  }, { })

  // Fetch related workspaces.
  const workspaces = yield db.collection('workspaces')
  .find({ membership_id: { $in: membershipIds } })
  .project({
    name: 1,
    display_name: 1,
    owner_id: 1,
    admins: 1,
    members: 1,
    created: 1,
    membership_id: 1
  })
  .sort({ _id: -1 })
  .limit(MAX_DOCS)
  .toArray()
  console.log(`Found ${workspaces.length} workspaces.`)

  // Extract key workspace members.
  const membersTmp = workspaces.reduce((acc, x) => {
    acc.push(...(x.admins || []), x.owner_id)
    return acc
  }, [])

  const members = [ ...new Set(membersTmp) ]
  const memberIds = members
  .filter((x) => x && x.length === 24)
  .map((x) => Mongo.getObjectId(x))

  // Fetch related users.
  const users = yield db.collection('users')
  .find({
    _id: { $in: memberIds },
    email: { $ne: 'system@taskworld.com' }
  })
  .project({
    email: 1,
    time_zone: 1,
    last_name: 1,
    first_name: 1,
    phone: 1,
    job_title: 1,
    department: 1,
    language: 1,
    address: 1,
    date_of_birth: 1
  })
  .sort({ _id: -1 })
  .toArray()
  console.log(`Found ${users.length} workspace members.`)

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

      const workspaceId = x._id.toString()
      const emailDomain = owner.email.trim().split('.').pop()
      let countryCode = emailDomain.toUpperCase()
      if (owner.time_zone && tzToCountry.zones[owner.time_zone]) {
        countryCode = tzToCountry.zones[owner.time_zone].countries[0]
      }

      // Extract key workspace members.
      const workspaceMembers = [...(x.admins || []), x.owner_id, ...(x.members || [])]
      const membersCount = new Set(workspaceMembers).size - 1 // Excluding the system user.

      // Skip solo workspaces.
      // if (membersCount < 2) return false

      return {
        workspaceId: workspaceId,
        workspaceDisplayName: x.display_name,
        workspaceCreatedDate: Moment(x.created).format('YYYY-MM-DD'),
        membersCount,
        countryCode,
        ownerName: `${owner.first_name} ${owner.last_name}`,
        ownerEmail: owner.email,
        ownerTimezone: owner.time_zone,
        ownerLanguage: owner.language,
        ownerPhone: owner.phone,
        ownerDetails: `Title: ${owner.job_title || ''}, Department: ${owner.department || ''}, Address: ${owner.address || ''}`,
        subscription: m.membership_type,
        subscriptionId: m.subscription_id,
        membershipStartDate: Moment(m.start_date).format()
      }
    }
    return false
  })
  .filter((x) => x)

  // Sort by country then date
  report.sort((a, b) => {
    const a1 = a.countryCode
    const a2 = b.countryCode
    const b1 = a.workspaceCreatedDate
    const b2 = b.workspaceCreatedDate
    if (a1 === a2) {
      return (b1 < b2) ? -1 : (b1 > b2) ? 1 : 0
    } else {
      return (a1 < a2) ? -1 : 1
    }
  })

  const reportFileName = `/tmp/tw-leads.csv`
  console.log(`Creating ${reportFileName} with ${report.length} rows ..`)

  // Dump to CSV.
  yield Util.writeCsv(report, reportFileName)

  yield * sendLeads(reportFileName)
}

function dbRun (func, args) {
  return Mongo.query(func, args)
  .then(Mongo.close)
  .catch((err) => console.error(err))
}
