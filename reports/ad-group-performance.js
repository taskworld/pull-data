'use strict'

const Fs = require('fs')
const Path = require('path')
const S3 = require('../lib/s3')

renderTaskworldReport('/tmp/ad-group-performance.json')

function renderTaskworldReport (adGroupJsonFile) {
  let html = Fs.readFileSync(Path.join(__dirname, 'layout.html'), 'utf8')

  html = html
  .replace('{{DATA}}', Fs.readFileSync(adGroupJsonFile, 'utf8'))
  .replace('{{SCRIPT}}', Fs.readFileSync(Path.join(__dirname, 'ad-group-performance-report-react.js'), 'utf8'))

  const reportFile = '/tmp/ad-group-performance.html'
  Fs.writeFileSync(reportFile, html)

  S3.uploadToS3(S3.createItem(reportFile))
  .then(res => {
    console.log('res=', res)
  })
}
