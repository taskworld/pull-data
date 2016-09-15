'use strict'

console.log('DEPRECATED. DO NO USE.')
process.exit(1)

const url = require('url')
const assert = require('assert')
const http = require('http')
const fs = require('fs')

assert(process.env.PULLDATA_CODE, 'Missing env `PULLDATA_CODE`')

http.createServer((req, res) => {
  const params = url.parse(req.url, true)
  if (params.query && params.query.code) {
    if (params.query.code === process.env.PULLDATA_CODE) {
      res.writeHead(200)
      fs.createReadStream('/tmp/customer-report.html').pipe(res)
      return
    }
  }
  res.writeHead(401)
  res.end(`Hmm ?!\n`)
})
.listen(10012)
