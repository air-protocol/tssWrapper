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

const initCheck = [
  check('home').exists().trim().escape(),
  check('vault').exists().trim().escape(),
  check('moniker').exists().trim().escape(),
  check('password').exists().trim().isLength({ min:9 }),
  check('override').optional().isBoolean()
]

app.post('/init', initCheck, (req, res) => {
  try{
    const errors = validationResult(req)
    if(!errors.isEmpty())
      return res.status(422).json({ errors: errors.array() })

    const { home, vault, moniker, password, override } = req.body
    let overrideOption = "n"

    if(override)
      overrideOption = "y"

    const echo = spawn("echo", ["-e", overrideOption])

    const tssInit = spawn("./tss", ["init", "--home", "/root/."+home, "--vault_name", vault, "--moniker", moniker, "--password", password])
    echo.stdout.pipe(tssInit.stdin)

    tssInit.stdout.on("data", function (data) {
      console.log("init spawnSTDOUT:", data.toString())
      const response = data.toString().indexOf("nothing happened");

      if(response !== -1){
        return res.status(400).send("Home and vault already exist. Nothing happened. To override set override param to true")
      }else{
        return res.status(200).send(data.toString())
      }
    })

    tssInit.stderr.on("data", function (data) { //tss init returns result as error
      console.log("init spawnSTDERR:", data.toString())
      const success = data.toString().indexOf("Local party has been initialized")

      if(success !== -1){
        return res.status(200).send("Local party has been initialized")
      }else{
        if(!res.headersSent)
          return res.status(400).send(data.toString())
      }
    })
  }catch(error){
    return res.status(500).send(error.message)
  }
})

app.listen(port, () => console.log(`Server listening on port ${port}!`))
