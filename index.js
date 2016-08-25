'use strict'

const Mongo = require('./mongodb')

pullDataFromMongoDb()

function pullDataFromMongoDb () {
  return Mongo.query(Mongo.sanityTest)
  .then(() => Mongo.query(exportMemberships))
  .then(Mongo.close)
  .catch((err) => console.error(err))
}

function * exportMemberships (db) {
  const memberships = yield db.collection('memberships')
  .find({ })
  .sort({ _id: -1 })
  .limit(10)
  .toArray()
  console.log(`Found ${memberships.length} memberships.`)

  const membershipIds = memberships.map((x) => x._id.toString())
  const workspaces = yield db.collection('workspaces')
  .find({ membership_id: { $in: membershipIds } })
  .sort({ _id: -1 })
  .limit(10)
  .toArray()
  console.log(`Found ${workspaces.length} workspaces.`)

  const members = workspaces.reduce((acc, x) => {
    return [ ...new Set(acc.concat(x.members, x.admins, x.owner_id)) ]
  }, [])

  const memberIds = members.map((x) => Mongo.getObjectId(x))
  const users = yield db.collection('users')
  .find({
    _id: { $in: memberIds },
    email: { $ne: 'system@taskworld.com' }
  })
  .project({ email: 1 })
  .sort({ _id: -1 })
  .toArray()

  console.log(users.length)
}
