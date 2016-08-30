'use strict'

const Fs = require('fs')
const Path = require('path')
const Util = require('../util')

renderTaskworldReport('/tmp/tw-data.csv')

function renderTaskworldReport (csvFile) {
  Util.readCsv(csvFile)
  .then((rows) => {
    let html = Fs.readFileSync(Path.join(__dirname, 'layout.html'), 'utf8')

    html = html
    .replace('{{DATA}}', JSON.stringify(rows, null, 2))
    .replace('{{SCRIPT}}', Fs.readFileSync(Path.join(__dirname, 'customer-report-react.js'), 'utf8'))

    Fs.writeFileSync('/tmp/customer-report.html', html)
  })
}
