'use strict'

const url = require('url')
const assert = require('assert')
const https = require('https')
const fs = require('fs')

assert(process.env.PULLDATA_TLS_CERT, 'Missing env `PULLDATA_TLS_CERT`')
assert(process.env.PULLDATA_TLS_PRIVKEY, 'Missing env `PULLDATA_TLS_PRIVKEY`')
assert(process.env.PULLDATA_HOST, 'Missing env `PULLDATA_HOST`')
assert(process.env.PULLDATA_CODE, 'Missing env `PULLDATA_CODE`')

const options = {
  key: fs.readFileSync(process.env.PULLDATA_TLS_PRIVKEY),
  cert: fs.readFileSync(process.env.PULLDATA_TLS_CERT)
}

https.createServer(options, (req, res) => {
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
.listen(10012, process.env.PULLDATA_HOST)
