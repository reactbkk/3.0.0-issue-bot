// @ts-check

const APP_ID = '13073'
const INSTALLATION_ID = '200680'
const APP_URL = 'https://github.com/apps/connor'

const jwt = require('jsonwebtoken')
const axios = require('axios').default
const log = require('pino')({ prettyPrint: true })
const stripSpaces = x => String(x).replace(/\s+/g, '')
const pk = require('fs').readFileSync('config/github-app-private-key.pem')
const serviceAccount = JSON.parse(
  require('fs').readFileSync('config/firebase-service-account.json', 'utf8')
)
const admin = require('firebase-admin')

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://reactbkk3.firebaseio.com'
})

process.on('unhandledRejection', up => {
  throw up
})

async function main() {
  const accessToken = await obtainAccessToken()
  log.info('Access token obtained...')

  const githubClient = createGitHubClient(accessToken)

  const issueSnapshot = await admin
    .firestore()
    .collection('github_issues')
    .get()
  log.info('Loaded issue list...')

  const docs = [...issueSnapshot.docs]
  for (const [i, doc] of [...docs].entries()) {
    const [owner, repo, issue] = doc.id.split(':')
    log.info(`Working on ${owner}/${repo}/issue/${issue}`)
    try {
      const said = []
      const say = (...thing) => {
        said.push(...thing, '')
      }
      const changes = await workOnIssue(owner, repo, issue, doc.data(), {
        githubClient,
        say,
        otherIssues: docs.filter((d, j) => i !== j).map(d => d.data())
      })
      log.info(
        { changes },
        `Finished working on ${owner}/${repo}/issue/${issue}`
      )
      await doc.ref.set(JSON.parse(JSON.stringify(changes)), { merge: true })
      log.info('Saved changes to Firestore.')

      const newDoc = await doc.ref.get()
      doc[i] = newDoc

      const commentId = (newDoc.data() || {}).informationCommentId
      if (commentId) {
        const url = `https://api.github.com/repos/${owner}/${repo}/issues/comments/${commentId}`
        const startTime = new Date((newDoc.data() || {}).startAt)
        const body = [
          '## โปรดอ่านก่อน',
          '',
          `Issue นี้ จะเปิดให้จองตอน ${startTime}`,
          '',
          `1. จอง issue โดย comment คำว่า “แย่งบัตรไม่ทัน งั้นขอจอง issue นี้นะ” ใน issue ` +
            ` โดยผู้ได้สิทธิการทำ issue นั้นคือผู้ที่ comment คนแรกสุด และ timestamp ต้องเป็นภายหลังเวลาเริ่มจองเท่านั้น`,
          `2. เมื่อถึงคิว ให้ส่ง pull request โดย prefix ว่า <code>[WIP] </code> (Work in progress) ` +
            `และนำ URL ของ pull request มาใส่ในคอมเม้นต์เพื่อยืนยันการจอง ภายใน 1 ชั่วโมง ` +
            `โดยขอสงวนสิทธิ์ในการมอบหมายงานให้คนถัดไปที่อยู่ในคิว หากไม่พบ pull request ภายใน 1 ชั่วโมง`,
          `3. ให้ update pull request (push commit เพิ่ม) อย่างน้อยทุกวันเพื่อทีมงานจะได้เข้าไปให้ feedback ได้ตั้งแต่ต้น ` +
            `ถ้า pull request ไม่ได้ update ทุกวัน ทีมงานขอสงวนสิทธิในการปิด (close) pull request ` +
            `และให้สิทธิท่านถัดไปที่จอง โดยจะมีระบบแจ้งเตือนก่อนหมดวัน`,
          `4. มีเวลา 5 วัน (120 ชั่วโมง) หลังจากเวลาที่จอง ในการทำ issue ให้สำเร็จ ` +
            `โดยจะถือว่าเสร็จสิ้นภารกิจเมื่อ pull request นั้นถูก merge โดยทีมงาน ` +
            `ดังนั้นควรเผื่อเวลาให้ทีมงานตรวจสอบและ feedback ไว้ด้วย ` +
            `(ในกรณีที่เป็น issue ที่เกี่ยวข้องกับ repository ภายนอก ให้ถือว่าทำสำเร็จเมื่อ pull request นั้นถูก merge โดยทีมที่ดูแล repository นั้น ๆ หรือทีมงาน React Bangkok approve โดยการปิด issue)`,
          `5. หลังจากที่ทำภารกิจเสร็จสิ้น และ issue ของ reactbkk ถูกปิดเรียบร้อย ` +
            `ให้เข้าไปที่ https://reactbkk.com/3.0.0/#free-tickets เพื่อรับรหัสในการรับบัตรเข้างานฟรี`,
          `6. สงวนสิทธิ 1 account ต่อ 1 issue เท่านั้น กล่าวคือไม่สามารถเป็นเจ้าของ issue ได้มากกว่า 1 อันในช่วงเวลาใดเวลาหนึ่ง ` +
            `และไม่สามารถเป็นเจ้าของ issue อื่นได้ หากได้ทำภารกิจสำเร็จไปแล้ว ` +
            `(แต่สามารถจองคิวในหลายๆ issue พร้อมๆ กันได้ โดยหากคุณถืองานอยู่แล้วเมื่อถึงคิว ระบบจะข้ามคิวของคุณให้โดยอัตโนมัติ)`,
          '',
          '<p align="right">connor[bot] is hosted by <a href="https://bangmod.cloud/">Bangmod.Cloud</a>.</p>',
          '',
          '<details><summary>Internal state</summary>',
          '',
          '```json',
          JSON.stringify(newDoc.data(), null, 2),
          '```',
          '',
          '</details>'
        ].join('\n')
        const oldBody = (await githubClient.get(url)).data.body
        if (stripSpaces(oldBody) !== stripSpaces(body)) {
          await githubClient.patch(url, {
            body
          })
          log.info('Updated comment.')
        } else {
          log.trace('Comment is the same.')
        }
      }

      if (said.length) {
        const createCommentUrl = `https://api.github.com/repos/${owner}/${repo}/issues/${issue}/comments`
        const createdComment = await githubClient.post(createCommentUrl, {
          body: said.join('\n')
        })
      }
    } catch (e) {
      log.error(
        e,
        `Unknown error while processing ${owner}/${repo}/issue/${issue}`
      )
    }
  }
}

/**
 * @typedef {Object} IssueState
 * @prop {{ [id: string]: boolean }} [processedComments]
 * @prop {[string]} [queuedUsers]
 * @prop {string} [informationCommentId]
 * @prop {string} [startAt]
 * @prop {ActiveIssue | null} [active]
 */

/**
 * @typedef {Object} ActiveIssue
 * @prop {string} username
 * @prop {string} startedAt
 * @prop {boolean | undefined | null} [pullRequestAbsenceWarned]
 * @prop {{ owner: string, repo: string, number: number, invalid?: string } | null} pullRequest
 */

/**
 * @param {string} owner
 * @param {string} repo
 * @param {string} issue
 * @param {IssueState} state
 * @param {object} stuff
 * @param {ReturnType<typeof createGitHubClient>} stuff.githubClient
 * @param {(...things) => void} stuff.say
 * @param {IssueState[]} stuff.otherIssues
 * @return {Promise<Partial<IssueState>>}
 */
async function workOnIssue(
  owner,
  repo,
  issue,
  state,
  { githubClient, say, otherIssues }
) {
  /** @type Partial<IssueState> */
  const changes = {}

  try {
    const processedComments = { ...(state.processedComments || {}) }
    const queuedUsers = [...(state.queuedUsers || [])]

    let informationCommentId = state.informationCommentId
    if (!informationCommentId) {
      const createCommentUrl = `https://api.github.com/repos/${owner}/${repo}/issues/${issue}/comments`
      const createdComment = await githubClient.post(createCommentUrl, {
        body: '[reserved by bot]'
      })
      changes.informationCommentId = createdComment.data.id
    }

    const url = `https://api.github.com/repos/${owner}/${repo}/issues/${issue}/comments?per_page=100`
    const githubComments = (await githubClient.get(url)).data
    log.info(`Found ${githubComments.length} comments`)

    let active = state.active

    for (const comment of githubComments) {
      if (!comment.user) {
        log.trace(`Skipping comment ${comment.id} as it does not have a user.`)
        continue
      }
      if (comment.user.html_url === APP_URL) {
        log.trace(`Skipping comment ${comment.id} as it is posted by bot.`)
        continue
      }
      if (processedComments[comment.id]) {
        log.trace(`Skipping comment ${comment.id} as it is already processed.`)
        continue
      }
      try {
        const username = comment.user.login
        const QUEUE_ISSUE = /แย่งบัตรไม่ทัน\s*งั้นขอจอง\s*issue\s*นี้นะ/i
        if (QUEUE_ISSUE.test(comment.body)) {
          if (
            state.startAt &&
            new Date(comment.created_at) < new Date(state.startAt)
          ) {
            log.info(
              `Not adding user @${username} to queue as it is not yet time to start.`
            )
            const startTime = new Date(state.startAt)
            if (new Date() >= startTime) {
              say(
                `@${username} ตอนที่คุณโพสต์คอมเม้นต์ Issue นี้ยังไม่เปิดให้จอง ` +
                  `กรุณาจองใหม่นะครับ ขอบคุณครับ`
              )
            } else {
              say(
                `@${username} Issue นี้ยังไม่เปิดให้จอง ` +
                  `โดยจะเปิดให้จองเมื่อถึงเวลา ${startTime} ` +
                  `กรุณาจองใหม่เมื่อถึงเวลานะครับ ขอบคุณครับ`
              )
            }
            continue
          }
          if (queuedUsers.includes(username)) {
            log.info(
              `Not adding user @${username} to queue as user is already in the queue.`
            )
            continue
          }
          if (active && active.username === username) {
            log.info(
              `Not adding user @${username} to queue as user is already in the queue.`
            )
            continue
          }
          queuedUsers.push(username)
          log.info(`Added user @${username} to queue.`)
          continue
        }
        if (active && active.username === username) {
          if (!active.pullRequest) {
            const PR_URL = /https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i
            const m = PR_URL.exec(comment.body)
            if (m) {
              active.pullRequest = {
                owner: m[1],
                repo: m[2],
                number: +m[3]
              }
              say(
                `@${username} คุณได้ยืนยันการจองเรียบร้อยแล้ว`,
                '',
                'อย่าลืม update pull request (push commit เพิ่ม) อย่างน้อยทุกวัน ' +
                  'เพื่อทีมงานจะได้เข้าไปให้ feedback ได้เรื่อย ๆ ' +
                  'ถ้าวันไหนคุณไม่ได้ update pull request ' +
                  'ทีมงานขอสงวนสิทธิในการปิด pull request นั้น และให้สิทธิท่านถัดไปที่จอง ' +
                  'โดยระบบจะแจ้งเตือนในเวลา 22:00 ถ้าหากวันนั้นคุณยังไม่ได้ update pull request'
              )
              continue
            }
          }
          if (/🏳️|:white_flag:/.test(comment.body)) {
            active = null
            say(`@${username} คุณได้สละสิทธิ์ให้คนถัดไปในคิว`)
          }
        }
      } finally {
        processedComments[comment.id] = true
      }
    }

    if (active && active.pullRequest && active.pullRequest.invalid) {
      const reason = active.pullRequest.invalid
      active.pullRequest = null
      active.startedAt = new Date().toISOString()
      say(
        `@${active.username} ` +
          `เราพบว่า pull request ของคุณไม่ถูกต้อง เนื่องจาก ${reason} ` +
          `กรุณาเปิด pull request ใหม่ และทำงานยืนยันการจองอีกครั้ง ` +
          `โดยให้นำ URL ของ pull request ใหม่มาคอมเม้นต์ครับ`
      )
    }

    if (!active || isExpired(active)) {
      if (!queuedUsers.length && active && !active.pullRequest) {
        if (!active.pullRequestAbsenceWarned) {
          active.pullRequestAbsenceWarned = true
          say(
            `@${
              active.username
            } คุณยังไม่ได้ยืนยันการจองโดยการนำ URL ของ pull request มาคอมเม้นต์ใน issue นี้ภายใน 1 ชั่วโมง ` +
              `หากคุณยังไม่ยืนยันการจองและมีคนมาจองต่อ ทางเราขอสงวนสิทธิ์ในการมอบหมายงานให้คนถัดไปนะครับ`
          )
        }
      }
      while (queuedUsers.length) {
        const username = queuedUsers.shift()
        if (!username) {
          continue
        }
        log.trace(`Dequeued user "${username}"`)
        if (isWorkingOnAnotherIssue(username, otherIssues)) {
          say(
            `@${username} คุณเป็นคิวถัดไปของ issue นี้ แต่เนื่องจากคุณกำลังทำอีก issue นึงอยู่ เราจึงข้ามไปให้คนถัดไป`
          )
          continue
        }
        if (active && !active.pullRequest) {
          say(
            `@${
              active.username
            } เนื่องจากคุณไม่ได้ยืนยันการจองภายใน 1 ชั่วโมง จึงขอสงวนสิทธิ์มอบหมายงานนี้ให้คนถัดไปนะครับ`
          )
        }
        active = {
          username,
          startedAt: new Date().toISOString(),
          pullRequest: null
        }
        say(
          `@${username} คุณได้รับมอบหมายในการทำ Issue นี้แล้ว~ 😃`,
          '',
          `กรุณาเปิด pull request โดย prefix ว่า <code>[WIP] </code> (Work in progress) ` +
            `และนำ URL ของ pull request มาใส่ในคอมเม้นต์เพื่อยืนยันการจอง ภายใน 1 ชั่วโมง ` +
            `โดยขอสงวนสิทธิ์ในการมอบหมายงานให้คนถัดไปที่อยู่ในคิว หากไม่พบ pull request ภายใน 1 ชั่วโมง`
        )
        break
      }
    }

    const labelsUrl = `https://api.github.com/repos/${owner}/${repo}/issues/${issue}/labels`
    /** @type {any[]} */
    const githubLabels = (await githubClient.get(labelsUrl)).data
    if (!active || isExpired(active)) {
      if (!githubLabels.some(l => l.name === 'available')) {
        await githubClient.post(labelsUrl, ['available'])
      }
    } else {
      if (githubLabels.some(l => l.name === 'available')) {
        await githubClient.delete(`${labelsUrl}/available`)
      }
    }

    Object.assign(changes, {
      processedComments,
      queuedUsers,
      active
    })
    return changes
  } catch (e) {
    e.changes = changes
    log.error(e, 'Failed to work on the issue.')
    throw e
  }
}

function createGitHubClient(accessToken) {
  const headers = {
    Accept: 'application/vnd.github.machine-man-preview+json'
  }
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`
  return axios.create({
    headers
  })
}

/**
 * @param {ActiveIssue} active
 */
function isExpired(active) {
  if (!active.pullRequest) {
    const started = new Date(active.startedAt)
    if (Date.now() > started.getTime() + 3600e3) {
      return true
    }
  }
  return false
}

/**
 * @param {string} username
 * @param {IssueState[]} otherIssues
 */
function isWorkingOnAnotherIssue(username, otherIssues) {
  return otherIssues.some(
    c => !!c.active && !isExpired(c.active) && c.active.username === username
  )
}

async function obtainAccessToken() {
  const appToken = jwt.sign({ iss: APP_ID }, pk, {
    algorithm: 'RS256',
    expiresIn: 300
  })
  const response = await createGitHubClient(appToken).post(
    'https://api.github.com/installations/' +
      INSTALLATION_ID +
      '/access_tokens',
    {}
  )
  if (!response.data.token) throw new Error('Oops, no token received')
  return response.data.token
}

main()
