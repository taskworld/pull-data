'use strict'

const Fs = require('fs')
const Path = require('path')
const S3 = require('../lib/s3')
const Moment = require('moment')

createTransactionsReport('/tmp/tw-transaction-log.json')

function createTxnEntry (ws, t, firstStartDate) {
  const workspaceId = ws._id.toString()
  return {
    workspaceId,
    workspaceName: ws.workspaceName,
    workspaceOwner: ws.workspaceOwner,
    workspaceEmail: ws.workspaceEmail,
    billingPeriodStartDate: t.billingPeriodStartDate,
    currentBillingCycle: t.currentBillingCycle || 0,
    amount: t.amount || 0,
    licenses: t.licenses,
    upsoldAmount: t.upsoldAmount || 0,
    plan: t.planId,
    firstStartDate
  }
}

function createTransactionsReport (transactionsJsonFile) {
  const data = require(transactionsJsonFile)
  const now = Moment()

  const upsold = data.reduce((acc, x) => {
    const workspaceId = x._id.toString()

    x.upsold.forEach(y => {
      const month = Moment(y.date).format('YYYY-MM')
      const amount = y.amount || 0

      if (!acc[month]) {
        acc[month] = { }
      }
      if (!acc[month][workspaceId]) {
        acc[month][workspaceId] = 0
      }
      acc[month][workspaceId] += amount
    })

    return acc
  }, { })

  const report = data.reduce((acc, x) => {
    let firstStartDate

    x.transactions.forEach((y, i) => {
      const workspaceId = x._id.toString()

      let date = null
      if (y.billingPeriodStartDate) date = Moment(y.billingPeriodStartDate, 'YYYY-MM-DD')
      if (y.date) date = Moment(y.date)
      if (!date) {
        console.log('Missing date for transaction:', y)
        return
      }

      // Keep track of the first transaction.
      if (i === 0) {
        firstStartDate = date.format('YYYY-MM-DD')
      }

      const past = date.format('YYYY-MM')
      if (past === 'Invalid date') {
        console.log('Invalid date for transaction:', y)
      }

      const amount = y.amount || 0

      if (!acc.past.items[past]) {
        acc.past.items[past] = []
      }

      const entry = createTxnEntry(x, y, firstStartDate)
      acc.past.items[past].push(entry)
      acc.past.stats.total += amount

      if (upsold[past] && upsold[past][workspaceId]) {
        const upsoldAmount = upsold[past][workspaceId]
        acc.past.stats.total += upsoldAmount
        entry.upsoldAmount = upsoldAmount
      }

      if (y.nextBillingDate) {
        const futureDay = Moment(y.nextBillingDate, 'YYYY-MM-DD')
        if (futureDay.isAfter(now)) {
          // console.log('Future billing detected:', futureDay.format('YYYY-MM-DD'))
          const futureMonth = futureDay.format('YYYY-MM')

          if (!acc.future.items[futureMonth]) {
            acc.future.items[futureMonth] = []
          }
          acc.future.items[futureMonth].push(createTxnEntry(x, y, firstStartDate))
          acc.future.stats.total += amount
        }
      }
    })

    return acc
  }, {
    past: {
      stats: { total: 0 },
      items: { }
    },
    future: {
      stats: { total: 0 },
      items: { }
    }
  })

  // console.log(JSON.stringify(report, null, 2))

  const createReport = map => {
    const rows = []

    let dates = Object.keys(map.items)
    dates.sort()

    dates.forEach((month, i) => {
      const totals = map.items[month].reduce((acc, x) => {
        const startMonth = x.firstStartDate.substr(0, 7)
        if (startMonth !== month) {
          acc.recurring += x.amount
        } else {
          if (x.licenses) {
            if (x.licenses > 250) x.licenses = 50
            acc.licenses += x.licenses
          }
          acc.new += x.amount
        }
        if (x.upsoldAmount) {
          acc.upsold += x.upsoldAmount
        }
        return acc
      }, {
        month,
        workspaces: new Set(map.items[month].map(x => x.workspaceId)).size,
        new: 0,
        recurring: 0,
        upsold: 0,
        total: 0,
        licenses: 0
      })

      totals.new = Math.round(totals.new)
      totals.recurring = Math.round(totals.recurring)
      totals.upsold = Math.round(totals.upsold)
      totals.total = totals.new + totals.recurring + totals.upsold

      rows.push(totals)
    })

    return rows
  }

  const past = createReport(report.past)
  const future = createReport(report.future)

  // console.log(JSON.stringify(past, null, 2))

  let html = Fs.readFileSync(Path.join(__dirname, 'layout.html'), 'utf8')
  html = html
  .replace('{{DATA}}', JSON.stringify({ past, future }))
  .replace('{{SCRIPT}}', Fs.readFileSync(Path.join(__dirname, 'transactions-report-react.js'), 'utf8'))

  const reportFile = '/tmp/transactions-report.html'
  Fs.writeFileSync(reportFile, html)

  if (process.argv[2] === 'upload') {
    S3.uploadToS3(S3.createItem(reportFile))
    .then(res => {
      console.log('res=', res)
    })
  }
}

function pad (str, size = 6) {
  const s = str.toString()
  const len = s.length
  const pad = ' '.repeat(size - len < 0 ? 0 : size - len)
  return pad + s
}
