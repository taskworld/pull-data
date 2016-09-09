'use strict'

const Fs = require('fs')
const Path = require('path')

renderTaskworldReport('/tmp/ad-group-performance.json')

function renderTaskworldReport (adGroupJsonFile) {
  let html = Fs.readFileSync(Path.join(__dirname, 'layout.html'), 'utf8')

  html = html
  .replace('{{DATA}}', Fs.readFileSync(adGroupJsonFile, 'utf8'))
  .replace('{{SCRIPT}}', Fs.readFileSync(Path.join(__dirname, 'ad-group-performance-report-react.js'), 'utf8'))

  Fs.writeFileSync('/tmp/ad-group-performance.html', html)
}
