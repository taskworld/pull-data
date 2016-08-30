'use strict'

const Fs = require('fs')
const Path = require('path')
const Util = require('../util')

renderTaskworldReport('/tmp/tw-data.csv')

function renderTaskworldReport (csvFile) {
  Util.readCsv(csvFile)
  .then((rows) => {
    const html = Fs.readFileSync(Path.join(__dirname, 'layout.html')).toString()
    Fs.writeFileSync(
      '/tmp/customer-report.html',
      html.replace('{{DATA}}', JSON.stringify(rows, null, 2))
    )
  })
}
