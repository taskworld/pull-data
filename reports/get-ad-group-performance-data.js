'use strict'

const P = require('bluebird')
const Fs = require('fs')
const Moment = require('moment')

const Util = require('../util')

renderAdStatsReport(
  '/tmp/adword-signups.csv',
  '/tmp/adword-stats.csv',
  '/tmp/tw-data.csv'
)

function renderAdStatsReport (adSignupCsvFile, adStatsCsvFile, twCsvFile) {
  return P.all([
    Util.readCsv(adSignupCsvFile),
    Util.readCsv(adStatsCsvFile),
    Util.readCsv(twCsvFile)
  ])
  .spread((signupRows, statsRows, twRows) => {
    const emailToCustomerMap = twRows.reduce((acc, x) => {
      acc[x['ownerEmail']] = x
      return acc
    }, { })

    const adGroupToEmailMap = signupRows.reduce((acc, x) => {
      const group = x['ga:adGroup']
      const email = x['ga:eventLabel']
      if (!acc[group]) {
        acc[group] = []
      }
      acc[group].push(email)
      return acc
    }, { })

    const statsReport = statsRows.reduce((acc, x) => {
      const group = x['ga:adGroup']
      const month = x['ga:date'].substr(0, 6)
      const cost = parseFloat(x['ga:adCost'])
      const clicks = parseInt(x['ga:adClicks'], 10)
      const signups = parseInt(x['ga:goal7Completions'], 10)

      if (!acc.month[month]) {
        acc.month[month] = {
          totalCostPaidMarketing: 0,
          totalClicks: 0,
          totalSignups: 0,
          totalCustomers: 0,
          totalLicenses: 0,
          signupsPaidMarketing: 0,
          licensesPaidMarketing: 0
        }
      }
      acc.month[month].totalCostPaidMarketing += cost
      acc.month[month].totalClicks += clicks
      acc.month[month].totalSignups += signups
      if (group !== '(not set)') {
        acc.month[month].signupsPaidMarketing += signups
      }

      if (!acc.adGroup[group]) {
        acc.adGroup[group] = {
          totalCostPaidMarketing: 0,
          totalClicks: 0,
          totalSignups: 0,
          customers: getCustomers(
            adGroupToEmailMap[group],
            emailToCustomerMap
          )
        }
      }
      acc.adGroup[group].totalCostPaidMarketing += cost
      acc.adGroup[group].totalClicks += clicks
      acc.adGroup[group].totalSignups += signups

      return acc
    }, {
      month: { },
      adGroup: { }
    })

    calculateMonthlyCustomerStats(statsReport)
    calculateAcquisitionCosts(statsReport)

    console.log('Report:', JSON.stringify(statsReport, null, 2))

    Fs.writeFileSync(
      '/tmp/ad-group-performance.json',
      JSON.stringify(statsReport, null, 2)
    )
  })
}

function calculateMonthlyCustomerStats (statsReport) {
  Object.keys(statsReport.adGroup).forEach(x => {
    statsReport.adGroup[x].customers.forEach(y => {
      const joinedMonth = Moment(y.subscriptionStartDate).format('YYYYMM')
      const r = statsReport.month[joinedMonth]
      r.totalCustomers++
      r.totalLicenses += parseInt(y.licenses, 10)
      if (x !== '(not set)') {
        r.licensesPaidMarketing += parseInt(y.licenses, 10)
      }
    })
  })
}

function calculateAcquisitionCosts (statsReport) {
  Object.keys(statsReport.month).forEach(x => {
    const m = statsReport.month[x]
    m.costPerSignupPaidMarketing = m.totalCostPaidMarketing / m.signupsPaidMarketing
    m.costPerLicensePaidMarketing = m.totalCostPaidMarketing / m.licensesPaidMarketing
    m.conversionRateAllChannels = (m.totalLicenses / m.totalSignups * 100).toFixed(2)
    m.conversionRatePaidMarketing = (m.licensesPaidMarketing / m.signupsPaidMarketing * 100).toFixed(2)
  })
}

function getCustomers (emails, emailToCustomerMap) {
  if (emails) {
    return emails
    .reduce((acc, email) => {
      if (emailToCustomerMap[email]) {
        acc.push(emailToCustomerMap[email])
      }
      return acc
    }, [])
  }
  return []
}
