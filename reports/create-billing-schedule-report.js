'use strict'

const Moment = require('moment')
const Util = require('../util')

createBillingScheduleReport('/tmp/tw-transaction-log.json')

function createBillingScheduleReport (transactionsJsonFile) {
  const data = require(transactionsJsonFile)

  const yesterday = Moment().subtract(1, 'day').startOf('day')
  const sixWeeks = Moment().subtract(6, 'weeks').startOf('day')
  const nineMonths = Moment().subtract(9, 'months').startOf('day')

  const stats = {
    expired: 0,
    churned: 0,
    total: 0,
    max: null,
    min: null,
    thisMonth: 0,
    lastMonth: 0
  }

  const report = []

  data.forEach((ws, i) => {
    const last = ws.transactions[ws.transactions.length - 1]

    const date = Moment(last.date)
    if (date.isBefore(nineMonths)) return

    const licenses = last.licenses ? (last.licenses < 1000 ? last.licenses : 50) : 0
    if (!last.billingPeriodStartDate || !last.nextBillingDate) {
      return
    }

    if (!stats.max || stats.max.isBefore(date)) stats.max = date
    if (!stats.min || stats.min.isAfter(date)) stats.min = date

    const startDate = Moment(last.billingPeriodStartDate, 'YYYY-MM-DD')
    const nextDate = Moment(last.nextBillingDate, 'YYYY-MM-DD')

    if (nextDate.isBefore(yesterday)) {
      if (nextDate.isBefore(sixWeeks)) {
        stats.churned += licenses
      } else {
        stats.expired += licenses
      }
      const daysAgo = nextDate.diff(yesterday, 'days')

      console.log(
        pad(i),
        pad(ws.workspaceName, 50),
        pad(`${startDate.format('YYYY-MM-DD')} -> ${nextDate.format('YYYY-MM-DD')}`, 30),
        pad(`${last.licenses} licenses`, 20),
        pad(`${Math.abs(daysAgo)} days ago`, 20)
      )

      report.push({
        number: i,
        workspace: ws.workspaceName,
        billingStart: startDate.format('YYYY-MM-DD'),
        billingNext: nextDate.format('YYYY-MM-DD'),
        licenses: last.licenses,
        expiredDaysAgo: Math.abs(daysAgo)
      })
    } else {
      stats.total += licenses
    }
  })

  const periodMonths = stats.max.diff(stats.min, 'months')

  const getTotals = () => {
    return `Expired: ${stats.expired}, ` +
           `Churned: ${stats.churned}, ` +
           `Total: ${stats.total}, ` +
           `Period: ${periodMonths} months, ` +
           `Monthly Churn Rate: ${(stats.churned / stats.total / periodMonths * 100).toFixed(3)} %`
  }

  console.log(getTotals())

  report.push({
    number: '',
    workspace: getTotals(),
    billingCycle: '',
    licenses: '',
    expiredDaysAgo: ''
  })

  const reportFileName = `/tmp/tw-billing-schedule.csv`
  console.log(`Creating ${reportFileName} with ${report.length} rows ..`)

  // Dump to CSV.
  return Util.writeCsv(report, reportFileName)
}

function pad (str, size = 6) {
  const s = String(str)
  const len = s.length
  const pad = ' '.repeat(size - len < 0 ? 0 : size - len)
  return s + pad
}
