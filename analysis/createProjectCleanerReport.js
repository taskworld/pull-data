'use strict'

const Fs = require('fs')
const Path = require('path')
const Moment = require('moment')
const S3 = require('../lib/s3')

renderTaskworldReport('/tmp/project-clean-data.json')

function renderTaskworldReport (projectCleanDataJson) {
  const report = require(projectCleanDataJson)

  let html = Fs.readFileSync(Path.join(__dirname, '..', 'reports', 'layout.html'), 'utf8')
  const script = Path.join(__dirname, 'react', 'projectCleanerReport.react.js')
  html = html
  .replace('{{DATA}}', JSON.stringify(report, null, 2))
  .replace('{{SCRIPT}}', Fs.readFileSync(script, 'utf8'))

  const reportFile = '/tmp/project-clean-report.html'
  Fs.writeFileSync(reportFile, html)

  if (process.argv[2] === 'upload') {
    S3.uploadToS3(S3.createItem(reportFile))
    .then(res => {
      console.log('res=', res)
    })
  }
}
