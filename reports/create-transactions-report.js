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
    currentBillingCycle: t.currentBillingCycle || 0,
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

      const past = date.format('YYYY-MM')
      if (past === 'Invalid date') {
        console.log('Invalid date for transaction:', y)
      }

      const amount = y.amount ? parseInt(y.amount, 10) : 0

      if (!acc.past.items[past]) {
        acc.past.items[past] = []
      }
      acc.past.items[past].push(createTxnEntry(x, y))
      acc.past.stats.total += amount

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
    past: {
      stats: { total: 0 },
      items: { }
    },
    future: {
      stats: { total: 0 },
      items: { }
    }
  })

  const print = map => {
    let dates = Object.keys(map.items)
    dates.sort()
    dates.forEach((date, i) => {
      const workspaceIds = new Set(map.items[date].map(x => x.workspaceId))
      const totals = map.items[date].reduce((acc, x) => {
        const isRecurring = x.currentBillingCycle > 1
        if (isRecurring) {
          acc.recurring += x.amount
        } else {
          acc.new += x.amount
        }
        return acc
      }, {
        new: 0,
        recurring: 0
      })

      const totalForDate = totals.new + totals.recurring
      console.log(
        `${date}: ${pad(workspaceIds.size)} workspaces, ` +
        `amounts:` +
        `${pad('$' + totals.new.toLocaleString(), 10)} new` +
        `${pad('$' + totals.recurring.toLocaleString(), 10)} recur - ` +
        `${pad('$' + totalForDate.toLocaleString(), 10)}`
      )
    })
  }

  console.log('Past Payments:')
  print(report.past)

  console.log('Future Payments:')
  print(report.future)

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

function pad (str, size = 6) {
  const s = str.toString()
  const len = s.length
  const pad = ' '.repeat(size - len < 0 ? 0 : size - len)
  return pad + s
}
