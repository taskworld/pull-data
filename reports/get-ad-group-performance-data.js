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

const _stats = {
  customersTotal: 0,
  emailsTotal: 0,
  emails: { },
  workspaces: { }
}

function renderAdStatsReport (adSignupCsvFile, adStatsCsvFile, twCsvFile) {
  return P.all([
    Util.readCsv(adSignupCsvFile),
    Util.readCsv(adStatsCsvFile),
    Util.readCsv(twCsvFile)
  ])
  .spread((signupRows, statsRows, twRows) => {
    // Rock on !
    const emailToCustomerMap = getEmailToCustomerMap(twRows)
    console.log('Unique customers:', Object.keys(emailToCustomerMap).length)

    const adGroupToEmailMap = getAdGroupToEmailMap(signupRows)
    console.log('Emails unique:', Object.keys(_stats.emails).length)

    // Add customers for which we do not have signup stats !
    let missingSignupStats = 0
    Object.keys(emailToCustomerMap).forEach(x => {
      if (!_stats.emails[x]) {
        adGroupToEmailMap['(not set)'].push(x)
        ++missingSignupStats
      }
    })
    console.log('Customers not in signup stats:', missingSignupStats)

    const statsReport = statsRows.reduce((acc, x) => {
      const group = x['ga:adGroup']
      const month = x['ga:date'].substr(0, 6)
      const cost = parseFloat(x['ga:adCost'])
      const clicks = parseInt(x['ga:adClicks'], 10)
      const signups = parseInt(x['ga:goal7Completions'], 10)

      if (!acc.month[month]) {
        acc.month[month] = createMonthEntry()
      }
      acc.month[month].totalCostPaidMarketing += cost
      acc.month[month].totalClicks += clicks
      acc.month[month].totalSignups += signups
      if (group !== '(not set)') {
        acc.month[month].signupsPaidMarketing += signups
      }

      if (!acc.adGroup[group]) {
        // console.log('AdGroup:', group)
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

    console.log('Report:', JSON.stringify(statsReport.month, null, 2))
    console.log('Total Licenses:', Object.keys(statsReport.month)
    .reduce((acc, x) => acc + statsReport.month[x].totalLicenses, 0))

    Fs.writeFileSync(
      '/tmp/ad-group-performance.json',
      JSON.stringify(statsReport, null, 2)
    )
  })
}

function calculateMonthlyCustomerStats (statsReport) {
  Object.keys(statsReport.adGroup).forEach(x => {
    statsReport.adGroup[x].customers.forEach(y => {
      const workspaceCreatedMonth = Moment(y.workspaceCreatedDate).format('YYYYMM')
      let r = statsReport.month[workspaceCreatedMonth]
      if (!r) {
        r = statsReport.month[workspaceCreatedMonth] = createMonthEntry()
      }
      if (y.subscription === 'premium') {
        const licenses = parseInt(y.licenses, 10)
        r.totalCustomers++
        r.totalLicenses += licenses
        if (x !== '(not set)') {
          r.licensesPaidMarketing += licenses
        }
      }
    })
  })
}

function calculateAcquisitionCosts (statsReport) {
  Object.keys(statsReport.month).forEach(x => {
    const m = statsReport.month[x]
    m.costPerSignupPaidMarketing = getNumber(m.totalCostPaidMarketing / m.signupsPaidMarketing)
    m.costPerLicensePaidMarketing = getNumber(m.totalCostPaidMarketing / m.licensesPaidMarketing)
    m.conversionRateAllChannels = getNumber(m.totalLicenses / m.totalSignups * 100).toFixed(2)
    m.conversionRatePaidMarketing = getNumber(m.licensesPaidMarketing / m.signupsPaidMarketing * 100).toFixed(2)
  })
}

function getNumber (n) {
  return !Number.isNaN(n) && Number.isFinite(n) ? n : 0
}

function getCustomers (emails, emailToCustomerMap) {
  if (emails) {
    return emails
    .reduce((acc, email) => {
      const customers = emailToCustomerMap[email]
      if (customers) {
        customers.forEach(x => {
          if (_stats.workspaces[x.workspaceName]) {
            console.log('Duplicate workspace detected:', x.workspaceDisplayName)
          }
          _stats.workspaces[x.workspaceName] = x.workspaceDisplayName
        })
        acc = acc.concat(customers)
      }
      return acc
    }, [])
  }
  return []
}

function createMonthEntry () {
  return {
    totalCostPaidMarketing: 0,
    totalClicks: 0,
    totalSignups: 0,
    totalCustomers: 0,
    totalLicenses: 0,
    signupsPaidMarketing: 0,
    licensesPaidMarketing: 0
  }
}

function getEmailToCustomerMap (twRows) {
  return twRows.reduce((acc, x) => {
    const email = x['ownerEmail']
    if (!acc[email]) {
      acc[email] = []
    }
    acc[email].push(x)
    return acc
  }, { })
}

function getAdGroupToEmailMap (signupRows) {
  return signupRows.reduce((acc, x) => {
    const group = x['ga:adGroup']
    const email = x['ga:eventLabel']
    if (!acc[group]) {
      acc[group] = []
    }

    if (_stats.emails[email]) {
      console.log(`Duplicate email found: ${email} in group ${group} (already in group ${_stats.emails[email]}).`)
      if (_stats.emails[email] === '(not set)') {
        _stats.emails[email] = group
      }
    } else {
      _stats.emails[email] = group
      acc[group].push(email)
    }

    return acc
  }, { })
}
