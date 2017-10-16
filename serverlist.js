const Assert = require('assert')

Assert(process.env.PULLDATA_MONGO_DB_URLS, 'Missing env `PULLDATA_MONGO_DB_URLS`')
Assert(process.env.PULLDATA_SERVERS_LIST, 'Missing env `PULLDATA_SERVERS_LIST`')

const dbUrls = process.env.PULLDATA_MONGO_DB_URLS.split(';')
const servers = process.env.PULLDATA_SERVERS_LIST.split(';')
const serversList = dbUrls.map((url, index) => (
  { dbUrl: url, serverName: servers[index] || 'Unknown server?' }
))

module.exports = {
  dbUrls,
  servers,
  serversList
}
