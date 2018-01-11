const P = require('bluebird')
const { serversList } = require('./serverlist')
const TaskworldService = require('./TaskworldService/taskworldService')
const Mongo = require('./mongodb')
const Util = require('./util')
const _ = require('lodash')
const { sendEmail } = require('./lib/sendgrid')

async function pullDataFromMongoDb (startDate, endDate) {
  const userChunks = await P.mapSeries(serversList, async server => {
    const db = await Mongo.connect(server.dbUrl)
    console.log(`Fetching users from ${server.dbUrl}...`)
    return TaskworldService.fetchAllUsers(db)
  })
  const users = _.flatten(userChunks)
  const report = users.map(c => {
    const omitUser = _.omit(c, 'metadata')
    return Object.assign(omitUser, {
      utmSource: _.get(c, 'metadata.signupMetadata.utm_source', ''),
      utmMedium: _.get(c, 'metadata.signupMetadata.utm_medium', ''),
      utmKeyword: _.get(c, 'metadata.signupMetadata.utm_keyword', ''),
      rawMetadata: JSON.stringify(_.get(c, 'metadata.signupMetadata', ''))
    })
  })
  await Util.writeCsv(report, '/tmp/tw-users.csv')
}

async function run (args) {
  try {
    await pullDataFromMongoDb()
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

run()