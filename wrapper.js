const express = require('express')
const bodyParser = require('body-parser')
const { check, validationResult, param } = require('express-validator')
const { spawn } = require('child_process')
const app = express()
const port = 3000

const middleware = [
  bodyParser.json(),
  bodyParser.urlencoded({ extended: true }),
  check()
]

app.use(middleware)

app.get('/', (req, res) => {
  res.send('live')
})

app.listen(port, () => console.log(`Server listening on port ${port}!`))
