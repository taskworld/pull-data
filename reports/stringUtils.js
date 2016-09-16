'use strict'

// const s1 = padString('abc', 30)
// const s2 = padString('abc', 15)
// const s3 = padString('abc', 2)

// console.log(`"${s1}"`, s1.length === 30)
// console.log(`"${s2}"`, s2.length === 15)
// console.log(`"${s3}"`, s3.length === 3)

function padString (_str, width) {
  let str = ''
  if (_str && _str.toFixed && !Number.isInteger(_str)) {
    str = _str.toFixed(2)
  } else if (_str != null) {
    str = _str.toString()
  }

  if (str.length >= width) {
    return str
  }
  const pad = [ ...new Array(width - str.length) ].map(x => ' ').join('')
  return pad + str
}

module.exports = {
  padString
}
