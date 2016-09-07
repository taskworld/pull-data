'use strict'

const P = require('bluebird')
const Fs = require('fs')
const Path = require('path')
const Moment = require('moment')

const Util = require('../util')

renderTaskworldReport('/tmp/tw-data.csv', '/tmp/adword-signups.csv')

function renderTaskworldReport (twCsvFile, adwordsCsvFile) {
  return P.all([
    Util.readCsv(twCsvFile),
    Util.readCsv(adwordsCsvFile)
  ])
  .spread((twRows, adwordsRows) => {
    const adMap = adwordsRows.reduce((acc, x) => {
      acc[x['ga:eventLabel']] = x
      return acc
    }, { })

    twRows.forEach((x) => {
      x.signupSource = ''
      x.channel = ''
      x.country = ''
      const source = adMap[x.ownerEmail]
      if (source) {
        if (source['ga:adGroup'] !== '(not set)') {
          x.signupSource = source['ga:adGroup'] + ': ' + source['ga:adMatchedQuery']
        }
        x.channel = source['ga:sourceMedium']
        x.country = source['ga:country']
      }
      x.membershipDays = Math.min(
        Moment(x.subscriptionEndDate).diff(Moment(x.subscriptionStartDate), 'days'),
        Moment().diff(Moment(x.subscriptionStartDate), 'days')
      )
    })

    let html = Fs.readFileSync(Path.join(__dirname, 'layout.html'), 'utf8')

    html = html
    .replace('{{DATA}}', JSON.stringify(twRows, null, 2))
    .replace('{{SCRIPT}}', Fs.readFileSync(Path.join(__dirname, 'customer-report-react.js'), 'utf8'))

    Fs.writeFileSync('/tmp/customer-report.html', html)
  })
}
