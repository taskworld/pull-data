'use strict'

const Moment = require('moment')
const Mongo = require('./mongodb')

pullDataFromMongoDb(
  Moment('2016-07-01').toDate(),
  Moment('2016-07-01').endOf('month').toDate()
)

function pullDataFromMongoDb (startDate, endDate) {
  console.log(`
  Pulling membership data:
  Start Date: ${startDate}
  End Date:   ${endDate}
  `)

  return Mongo.query(exportMemberships, {
    startDate,
    endDate
  })
  .then(Mongo.close)
  .catch((err) => console.error(err))
}

function * exportMemberships (db, opts) {
  console.log('Exporting.')

  const memberships = yield db.collection('memberships')
  .find({ start_date: { $gte: opts.startDate, $lt: opts.endDate }})
  .sort({ _id: -1 })
  .limit(100)
  .toArray()
  console.log(`Found ${memberships.length} memberships.`)

  const membershipIds = memberships.map((x) => x._id.toString())
  const workspaces = yield db.collection('workspaces')
  .find({ membership_id: { $in: membershipIds } })
  .sort({ _id: -1 })
  .limit(100)
  .toArray()
  console.log(`Found ${workspaces.length} workspaces.`)

  const members = workspaces.reduce((acc, x) => {
    return [ ...new Set(acc.concat(x.members, x.admins, x.owner_id)) ]
  }, [])

  const memberIds = members
  .filter((x) => x && x.length === 24)
  .map((x) => Mongo.getObjectId(x))

  const users = yield db.collection('users')
  .find({
    _id: { $in: memberIds },
    email: { $ne: 'system@taskworld.com' }
  })
  .project({ email: 1 })
  .sort({ _id: -1 })
  .toArray()

  const userMap = users.reduce((acc, x) => {
    acc[x._id.toString()] = x.email
    return acc
  }, { })

  const workspaceMap = workspaces.reduce((acc, x) => {
    if (x.membership_id) {
      acc[x.membership_id] = {
        name: x.name,
        display_name: x.display_name,
        owner: userMap[x.owner_id],
        admins: x.admins.map((userId) => userMap[userId])
      }
    }
    return acc
  }, { })

  console.log(userMap)
  console.log(workspaceMap)
}
