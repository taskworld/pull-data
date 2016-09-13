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

    // Add all customers for which we don’t have signup stats !
    let missingSignupStats = 0
    Object.keys(emailToCustomerMap).forEach(x => {
      if (!_stats.emails[x]) {
        adGroupToEmailMap['(not set)'].push(x)
        ++missingSignupStats
      }
    })
    console.log('Customers missing signup stats:', missingSignupStats)

    const statsReport = statsRows.reduce((acc, x) => {
      const group = x['ga:adGroup']
      const month = x['ga:date'].substr(0, 6)
      const cost = parseFloat(x['ga:adCost'])
      const clicks = parseInt(x['ga:adClicks'], 10)
      const signups = parseInt(x['ga:goal7Completions'], 10)
      const sessions = parseInt(x['ga:sessions'], 10)

      if (!acc.month[month]) {
        acc.month[month] = createStatsEntry()
      }
      acc.month[month].totalCostPaidMarketing += cost
      acc.month[month].totalClicks += clicks
      acc.month[month].totalSignups += signups
      acc.month[month].totalSessions += sessions

      if (!acc.adGroup[group]) {
        acc.adGroup[group] = createStatsEntry()
        acc.adGroup[group].customers = getCustomers(
          adGroupToEmailMap[group], emailToCustomerMap
        )
      }
      acc.adGroup[group].totalCostPaidMarketing += cost
      acc.adGroup[group].totalClicks += clicks
      acc.adGroup[group].totalSignups += signups
      acc.adGroup[group].totalSessions += sessions

      if (group !== '(not set)') {
        acc.month[month].signupsPaidMarketing += signups
        acc.adGroup[group].signupsPaidMarketing += signups
      }

      return acc
    }, {
      month: { },
      adGroup: { }
    })

    calculateCustomerStats(statsReport)
    calculateAcquisitionCosts(statsReport)

    console.log('Report:', JSON.stringify(statsReport.adGroup['(not set)'], null, 2).substr(0, 1024))
    console.log('Total Licenses:', Object.keys(statsReport.month)
    .reduce((acc, x) => acc + statsReport.month[x].totalLicenses, 0))

    Fs.writeFileSync(
      '/tmp/ad-group-performance.json',
      JSON.stringify(statsReport, null, 2)
    )
  })
}

function calculateCustomerStats (statsReport) {
  // Sum licences for each AdGroup.
  Object.keys(statsReport.adGroup).forEach(adGroup => {
    const adGroupRef = statsReport.adGroup[adGroup]
    adGroupRef.customers.forEach(customer => {
      let m
      const licenses = parseInt(customer.licenses, 10)
      switch (customer.subscription) {

        case 'premium':
          const workspaceDate = Moment(customer.workspaceCreatedDate)
          const workspaceMonth = workspaceDate.format('YYYYMM')
          m = statsReport.month[workspaceMonth]
          if (!m) {
            m = statsReport.month[workspaceMonth] = createStatsEntry()
          }
          m.totalCustomers++

          m.totalLicenses += licenses
          adGroupRef.totalLicenses += licenses
          addWeekStat(statsReport, workspaceDate, 'totalLicenses', licenses)
          addWeekStat(adGroupRef, workspaceDate, 'totalLicenses', licenses)

          if (adGroup !== '(not set)') {
            m.licensesPaidMarketing += licenses
            adGroupRef.licensesPaidMarketing += licenses
            addWeekStat(statsReport, workspaceDate, 'licensesPaidMarketing', licenses)
            addWeekStat(adGroupRef, workspaceDate, 'licensesPaidMarketing', licenses)
          }
          break

        case 'canceled':
          const endDate = Moment(customer.subscriptionEndDate)
          const endMonth = endDate.format('YYYYMM')
          m = statsReport.month[endMonth]
          if (!m) {
            m = statsReport.month[endMonth] = createStatsEntry()
          }

          m.totalLicensesChurned += licenses
          adGroupRef.totalLicensesChurned += licenses
          addWeekStat(statsReport, endDate, 'totalLicensesChurned', licenses)
          addWeekStat(adGroupRef, endDate, 'totalLicensesChurned', licenses)

          if (adGroup !== '(not set)') {
            m.licensesPaidMarketingChurned += licenses
            adGroupRef.licensesPaidMarketingChurned += licenses
            addWeekStat(statsReport, endDate, 'licensesPaidMarketingChurned', licenses)
            addWeekStat(adGroupRef, endDate, 'licensesPaidMarketingChurned', licenses)
          }
          break
      }
    })
  })
}

function calcStats (e) {
  e.costPerSignupPaidMarketing = getNumber(e.totalCostPaidMarketing / e.signupsPaidMarketing)
  e.costPerLicensePaidMarketing = getNumber(e.totalCostPaidMarketing / e.licensesPaidMarketing)
  e.costPerLicenseAllChannels = getNumber(e.totalCostPaidMarketing / e.totalLicenses)
  e.conversionRateAllChannels = getNumber(e.totalLicenses / e.totalSignups * 100).toFixed(2)
  e.conversionRatePaidMarketing = getNumber(e.licensesPaidMarketing / e.signupsPaidMarketing * 100).toFixed(2)
  e.conversionRateSessions = getNumber(e.totalLicenses / e.totalSessions * 100).toFixed(2)
}

function calculateAcquisitionCosts (statsReport) {
  Object.keys(statsReport.month).forEach(x => calcStats(statsReport.month[x]))
  Object.keys(statsReport.adGroup).forEach(x => calcStats(statsReport.adGroup[x]))
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
          // Guard against duplicate workspaces.
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

function createStatsEntry () {
  return {
    totalCostPaidMarketing: 0,
    totalClicks: 0,
    totalSignups: 0,
    totalCustomers: 0,
    totalLicenses: 0,
    totalLicensesChurned: 0,
    totalSessions: 0,
    signupsPaidMarketing: 0,
    licensesPaidMarketing: 0,
    licensesPaidMarketingChurned: 0
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

function addWeekStat (entry, date, key, value) {
  // Create a map holding week stats.
  if (!entry.weeks) {
    entry.weeks = { }
  }
  const week = date.format('YYYY[_]WW')
  let w = entry.weeks[week]
  if (!w) {
    w = entry.weeks[week] = createStatsEntry()
  }
  w[key] += value
}
