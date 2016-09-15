'use strict'

const Fs = require('fs')
const Path = require('path')
const S3 = require('../lib/s3')

renderTaskworldReport('/tmp/marketing-performance-combined.json')

function renderTaskworldReport (adGroupJsonFile) {
  let html = Fs.readFileSync(Path.join(__dirname, 'layout.html'), 'utf8')

  html = html
  .replace('{{DATA}}', Fs.readFileSync(adGroupJsonFile, 'utf8'))
  .replace('{{SCRIPT}}', Fs.readFileSync(Path.join(__dirname, 'marketing-performance-report-react.js'), 'utf8'))

  const reportFile = '/tmp/marketing-performance-report.html'
  Fs.writeFileSync(reportFile, html)

  if (process.argv[2] === 'upload') {
    S3.uploadToS3(S3.createItem(reportFile))
    .then(res => {
      console.log('res=', res)
    })
  }
}
