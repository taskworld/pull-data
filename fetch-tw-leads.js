'use strict'

const P = require('bluebird')
const Moment = require('moment')
const Mongo = require('./mongodb')
const Util = require('./util')
const Fs = require('fs')
const Sendgrid = require('./lib/sendgrid')
const S3 = require('./lib/s3')

const { serversList } = require('./serverlist')

P.promisifyAll(Fs)
const MAX_DOCS = 50000
const tzToCountry = require('moment-timezone/data/meta/latest.json')

// console.log(tzToCountry.zones['Asia/Tokyo'].countries)
P.coroutine(run)()

function * run () {
  const args = require('minimist')(process.argv.slice(2))

  if (args.leads) {
    return yield * fetchLeads(args)
  }

  console.log(`
  Usage: node fetch-tw-leads.js
    --leads           Export leads
      [--country]     One or more country codes, e.g DE,SE,KR
      [--from]        From date, e.g. 2016-07-01
      [--to]          To date, e.g. 2016-07-31
      [--upload]      Upload report to secret S3 location.
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

async function fetchFromDbUrl (dbUrl, {
  countries,
  startDate,
  endDate,
  server
}) {
  const db = await Mongo.connect(dbUrl)
  console.log(`Fetch leads from server: ${server}`)
  return exportLeadsForDb(db, {
    countries,
    startDate,
    endDate,
    server
  })
}

function * fetchLeads ({ country, from, to, send, upload }) {
  const countries = (country || '').trim().split(/\s*,\s*/)
  const startDate = from ? Moment(from, 'YYYY-MM-DD') : Moment().subtract(4, 'day').startOf('day')
  const endDate = to ? Moment(to, 'YYYY-MM-DD') : Moment().add(1, 'day').endOf('day')

  console.log(`
  Fetching leads:
  Countries:        ${countries.join(', ')}
  Membership range: ${startDate.format()} - ${endDate.format()}
  `)

  const reports = yield P.mapSeries(serversList, server => fetchFromDbUrl(server.dbUrl, {
    countries,
    startDate,
    endDate,
    server: server.serverName
  }))

  const allReports = reports.reduce((acc, val) => [ ...acc, ...val ], [ ])

  const reportFileName = `/tmp/tw-leads.csv`
  console.log(`Creating ${reportFileName} with ${allReports.length} rows ..`)
  
  // Dump to CSV.
  yield Util.writeCsv(allReports, reportFileName)

  if (send) {
    yield * sendLeads(reportFileName)
  }

  if (upload) {
    const res = yield S3.uploadToS3(S3.createItem(reportFileName, 'tw-leads'))
    console.log('res=', res)
  }

  console.log('Done.')
  process.exit(0)
}

async function exportLeadsForDb (db, opts) {
  // // Fetch all trial memberships.
  // const query = {
  //   membership_type: 'free_trial',
  //   start_date: {
  //     $gte: opts.startDate.toDate(),
  //     $lt: opts.endDate.toDate()
  //   }
  // }

  // Fetch related workspaces.
  const workspaces = await db.collection('workspaces')
  .find({
    created: {
      $gte: opts.startDate.toDate(),
      $lt: opts.endDate.toDate()
    }
  })
  .project({
    name: 1,
    display_name: 1,
    owner_id: 1,
    admins: 1,
    members: 1,
    created: 1
  })
  .sort({ _id: -1 })
  .limit(MAX_DOCS)
  .toArray()
  console.log(`Found ${workspaces.length} workspaces.`)
  const spaceIds = workspaces.map((x) => String(x._id))

  const memberships = await db.collection('memberships')
  .find({
    membership_type: 'free_trial',
    space_id: {
      $in: spaceIds
    }
  })
  .sort({ _id: -1 })
  .limit(MAX_DOCS)
  .toArray()
  console.log(`Found ${memberships.length} memberships.`)

  const workspacesMap = workspaces.reduce((acc, x) => {
    acc[x._id.toString()] = x
    return acc
  }, { })

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
  const users = await db.collection('users')
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
    date_of_birth: 1,
    country: 1,
    industry: 1,
    company_size: 1,
    'settings.customer_support': 1
  })
  .sort({ _id: -1 })
  .toArray()
  console.log(`Found ${users.length} workspace members.`)

  const userMap = users.reduce((acc, x) => {
    acc[x._id.toString()] = x
    return acc
  }, { })

  const report = memberships.map((m) => {
    if (m.space_id) {
      const w = workspacesMap[m.space_id]
      if (!w) {
        return false
      }
      const owner = userMap[w.owner_id]
      if (!owner) {
        console.error('Unknown workspace owner:', w.owner_id)
        return false
      }
      if (!owner.settings.customer_support === false) {
        console.log(`User with email ${owner.email} did not give us consent`)
        return false
      }

      const workspaceId = w._id.toString()
      const emailDomain = owner.email.trim().split('.').pop()
      let countryCode = emailDomain.toUpperCase()
      if (owner.time_zone && tzToCountry.zones[owner.time_zone]) {
        countryCode = tzToCountry.zones[owner.time_zone].countries[0]
      }

      // Extract key workspace members.
      const workspaceMembers = [...(w.admins || []), w.owner_id, ...(w.members || [])]
      const membersCount = new Set(workspaceMembers).size - 1 // Excluding the system user.

      // Skip solo workspaces.
      // if (membersCount < 2) return false

      return {
        workspaceId: workspaceId,
        workspaceDisplayName: w.display_name,
        workspaceCreatedDate: Moment(w.created).format('YYYY-MM-DD'),
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
        membershipStartDate: Moment(m.start_date).format(),
        ownerSignupCountry: owner.country,
        ownerSignupCompanySize: owner.company_size,
        ownerSignupIndustry: owner.industry,
        server: opts.server
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

  return report
}
