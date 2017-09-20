/*
  global
  firebase
*/
const config = {
  apiKey: 'AIzaSyAGynYjuQ5zJ7bJngNOo6glkqe5T_GFOp8',
  authDomain: 'tw-customer-dashboard.firebaseapp.com',
  databaseURL: 'https://tw-customer-dashboard.firebaseio.com',
  projectId: 'tw-customer-dashboard',
  storageBucket: 'tw-customer-dashboard.appspot.com',
  messagingSenderId: '242048312097'
}
firebase.initializeApp(config)
firebase.auth().signInAnonymously()

let usersData = null

export function writeUserData (spaceId, { month, country, channel, signupSource, licenses }) {
  firebase.database().ref('workspaces/' + spaceId).set({
    month,
    country,
    channel,
    signupSource,
    licenses: licenses || 1
  })
}

export async function getUsersData (spaceId) {
  await prepareData()
  return usersData[spaceId]
}

export async function prepareData () {
  if (!usersData) {
    usersData = await getAllData()
  }
}

export function getAllData () {
  return new Promise(resolve => {
    firebase.database().ref('/workspaces').once('value').then(function (snapshot) {
      resolve(snapshot.val())
    })
  })
}

window.getAllData = getAllData
