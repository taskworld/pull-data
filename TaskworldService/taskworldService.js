async function fetchUsersByIds (db, memberIds) {
  return db.collection('users')
  .find({
    _id: { $in: memberIds }
  })
  .project({ email: 1, time_zone: 1, last_name: 1, first_name: 1, metadata: 1, country: 1 })
  .sort({ _id: -1 })
  .toArray()
}

function fetchAllUsers (db) {
  return db.collection('users')
  .find({
  })
  .project({ email: 1, time_zone: 1, last_name: 1, first_name: 1, metadata: 1, country: 1 })
  .sort({ _id: -1 })
  .toArray()
}

module.exports = {
  fetchUsersByIds,
  fetchAllUsers
}
