'use strict'

const Fs = require('fs')
const Path = require('path')
const S3 = require('../lib/s3')
const Moment = require('moment')

renderTaskworldReport('/tmp/tw-transaction-log.json')

function createTxnEntry (ws, t) {
  return {
    workspaceId: ws._id.toString(),
    workspaceName: ws.workspaceName,
    workspaceOwner: ws.workspaceOwner,
    workspaceEmail: ws.workspaceEmail,
    billingPeriodStartDate: t.billingPeriodStartDate,
    amount: t.amount ? parseInt(t.amount, 10) : 0,
    plan: t.planId
  }
}

function renderTaskworldReport (transactionsJsonFile) {
  const data = require(transactionsJsonFile)
  const now = Moment()

  const report = data.reduce((acc, x) => {
    x.transactions.forEach(y => {
      let date = null
      if (y.billingPeriodStartDate) date = Moment(y.billingPeriodStartDate, 'YYYY-MM-DD')
      if (y.date) date = Moment(y.date)
      if (!date) {
        console.log('Missing date for transaction:', y)
        return
      }

      const month = date.format('YYYY-MM')
      if (month === 'Invalid date') {
        console.log('Invalid date for transaction:', y)
      }

      const amount = y.amount ? parseInt(y.amount, 10) : 0

      if (!acc.month.items[month]) {
        acc.month.items[month] = []
      }
      acc.month.items[month].push(createTxnEntry(x, y))
      acc.month.stats.total += amount

      if (y.nextBillingDate) {
        const futureDay = Moment(y.nextBillingDate, 'YYYY-MM-DD')
        if (futureDay.isAfter(now)) {
          // console.log('Future billing detected:', futureDay.format('YYYY-MM-DD'))
          const futureMonth = futureDay.format('YYYY-MM')

          if (!acc.future.items[futureMonth]) {
            acc.future.items[futureMonth] = []
          }
          acc.future.items[futureMonth].push(createTxnEntry(x, y))
          acc.future.stats.total += amount
        }
      }
    })
    return acc
  }, {
    month: {
      stats: { total: 0 },
      items: { }
    },
    future: {
      stats: { total: 0 },
      items: { }
    }
  })

  const printMonthReport = (title, map) => {
    console.log('Report:', title)
    let months = Object.keys(map.items)
    months.sort()
    months.forEach(month => {
      const items = map.items[month]
      const workspaceCount = (new Set(items.map(x => x.workspaceId))).size
      const totalAmount = items.reduce((acc, x) => acc + x.amount, 0)
      console.log(`${month}: ${workspaceCount} workspaces, amount: $${totalAmount.toLocaleString()}`)
    })
    console.log(`Total recurring: $${map.stats.total.toLocaleString()}`)
  }

  printMonthReport('Future Payments', report.future)
  printMonthReport('Past Payments', report.month)

  // let html = Fs.readFileSync(Path.join(__dirname, 'layout.html'), 'utf8')
  //
  // html = html
  // .replace('{{DATA}}', Fs.readFileSync(transactionsJsonFile, 'utf8'))
  // .replace('{{SCRIPT}}', Fs.readFileSync(Path.join(__dirname, 'transactions-report-react.js'), 'utf8'))
  //
  // const reportFile = '/tmp/transactions-report.html'
  // Fs.writeFileSync(reportFile, html)
  //
  // if (process.argv[2] === 'upload') {
  //   S3.uploadToS3(S3.createItem(reportFile))
  //   .then(res => {
  //     console.log('res=', res)
  //   })
  // }
}
