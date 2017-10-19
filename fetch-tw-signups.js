'use strict'

const P = require('bluebird')
const _ = require('lodash')
const Moment = require('moment')
const Mongo = require('./mongodb')
const Util = require('./util')
const Fs = require('fs')
const { serversList } = require('./serverlist')
const S3 = require('./lib/s3')
P.promisifyAll(Fs)

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
  await pullDataFromMongoDb(
    Moment(args.from),
    Moment(args.to), {
      upload: args.upload
    }
  )
}

async function pullDataFromMongoDb (startDate, endDate, { upload }) {
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
  await writeReportToCsv(allReports, {
    upload
  })
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

  // Fetch all related users.
  const users = await db.collection('users')
  .find({
    created: {
      $gte: opts.startDate.toDate(),
      $lt: opts.endDate.toDate()
    }
  })
  .project({ email: 1, time_zone: 1, last_name: 1, first_name: 1, metadata: 1, created: 1 })
  .sort({ _id: -1 })
  .toArray()

  console.log(`User counts: ${users.length}`)

  const userReport = users.filter(user => !isBlacklistedEmailAddress(user)).map(user => ({
    email: user.email,
    utmSource: _.get(user, 'metadata.signupMetadata.utm_source', 'unknown'),
    utmMedium: _.get(user, 'metadata.signupMetadata.utm_medium', 'unkown'),
    created: Moment(user.created).format(),
    serverName
  }))

  return userReport
}

async function writeReportToCsv (report, { upload }) {
  const reportFileName = `/tmp/tw-signups.csv`
  console.log(`Creating ${reportFileName} with ${report.length} rows ..`)

  // Dump to CSV.
  await Util.writeCsv(report, reportFileName)

  if (upload) {
    const res = await S3.uploadToS3(S3.createItem(reportFileName, 'tw-signups'))
    console.log('res=', res)
  }
  console.log('Done')
  process.exit(0)
}
