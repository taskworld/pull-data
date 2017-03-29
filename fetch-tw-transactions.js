'use strict'

const P = require('bluebird')
const Mongo = require('./mongodb')
const Fs = require('fs')
P.promisifyAll(Fs)

const MAX_DOCS = 10000

Mongo.query(run, require('minimist')(process.argv.slice(2)))

function * run (db, args) {
  console.log('Pulling transactions ..')
  const history = yield * getTransactionHistory(db)

  yield * getUpsoldTransactions(db, history)
  yield * getWorkspaceInfoForHistory(db, history)

  const reportFileName = `/tmp/tw-transaction-log.json`
  yield Fs.writeFileAsync(reportFileName, JSON.stringify(history, null, 2))

  Mongo.close()
}

function * getWorkspaceInfoForHistory (db, history) {
  // Fetch all related workspaces.
  let workspaceIds = history.map((x) => x._id.toString())
  workspaceIds = [...new Set(workspaceIds)]

  const workspaces = yield db.collection('workspaces')
  .find({ _id: { $in: workspaceIds.map(Mongo.getObjectId) } })
  .project({ name: 1, display_name: 1, owner_id: 1, created: 1 })
  .sort({ _id: -1 })
  .limit(MAX_DOCS)
  .toArray()
  console.log(`Found ${workspaces.length} workspaces.`)

  const workspaceMap = workspaces.reduce((acc, x) => {
    acc[x._id.toString()] = x
    return acc
  }, { })

  // Fetch all workspace owners.
  let userIds = workspaces
  .filter(x => x.owner_id && x.owner_id.length === 24)
  .map(x => x.owner_id)
  userIds = [...new Set(userIds)]

  const users = yield db.collection('users')
  .find({ _id: { $in: userIds.map(Mongo.getObjectId) } })
  .project({ email: 1, first_name: 1, last_name: 1 })
  .sort({ _id: -1 })
  .limit(MAX_DOCS)
  .toArray()
  console.log(`Found ${users.length} users.`)

  const userMap = users.reduce((acc, x) => {
    acc[x._id.toString()] = x
    return acc
  }, { })

  history.forEach(x => {
    const workspace = workspaceMap[x._id.toString()]
    if (workspace) {
      x.workspaceName = workspace.display_name
      const user = userMap[workspace.owner_id]
      if (user) {
        x.workspaceOwner = `${user.first_name} ${user.last_name}`
        x.workspaceOwnerEmail = user.email
      }
    }
  })
}

function * getTransactionHistory (db, opts) {
  const $match = {
    action: 'subscription_charged_successfully',
    workspace_id: { $exists: true },
    success: true
  }
  const $project = {
    workspace_id: 1,
    created: 1,
    _id: 1,
    transaction_amount: 1,
    membership: 1,
    billingPeriodStartDate: '$raw_response.subject.subscription.billingPeriodStartDate',
    nextBillingDate: '$raw_response.subject.subscription.nextBillingDate',
    currentBillingCycle: '$raw_response.subject.subscription.currentBillingCycle',
    planId: '$raw_response.subject.subscription.planId'
  }
  const $sort1 = { created: 1 }
  const $sort2 = { created: -1 }
  const $group = {
    _id: '$workspace_id',
    created: { $max: '$created' },
    transactions: {
      $push: {
        amount: '$transaction_amount',
        date: '$created',
        licenses: '$membership.user_limit',
        billingPeriodStartDate: '$billingPeriodStartDate',
        nextBillingDate: '$nextBillingDate',
        currentBillingCycle: '$currentBillingCycle',
        planId: '$planId'
      }
    }
  }

  return yield db.collection('transaction_logs')
  .aggregate([
    { $match },
    { $project },
    { $sort: $sort1 },
    { $group },
    { $sort: $sort2 }
  ])
  .toArray()
}

function * getUpsoldTransactions (db, history) {
  const $project = {
    workspace_id: 1,
    created: 1,
    transaction_amount: 1,
    membership: 1
  }

  const upsoldTransactions = yield db.collection('transaction_logs')
  .find({
    action: 'makeSale',
    workspace_id: { $exists: true },
    success: true
  })
  .project($project)
  .sort({ created: 1 })
  .toArray()

  const upsoldMap = upsoldTransactions.reduce((acc, x) => {
    if (!acc[x.workspace_id]) {
      acc[x.workspace_id] = []
    }
    acc[x.workspace_id].push({
      date: x.created,
      amount: x.transaction_amount
    })
    return acc
  }, { })

  history.forEach(x => {
    const workspaceId = x._id.toString()
    x.upsold = upsoldMap[workspaceId] || []
  })
}
