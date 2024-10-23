import fs from 'fs'
import path from 'path'
import cheerio from 'cheerio'
import { version as nextVersion } from 'next/package.json'
import type { Route } from 'playwright'
import { retry } from 'next-test-utils'
import { nextTestSetup, isNextStart } from 'e2e-utils'

// This feature is only relevant to Webpack.
;(process.env.TURBOPACK ? describe.skip : describe)(
  'should output updated trace files',
  () => {
    if (!isNextStart) {
      it('should skip for non-next start', () => {})
      return
    }
    const { next } = nextTestSetup({
      files: __dirname,
      dependencies: {
        nanoid: '4.0.1',
      },
      env: {
        NEXT_PRIVATE_FLYING_SHUTTLE_STORE_ONLY: '1',
      },
    })
    let initialConfig: Record<string, any> = {}
    let testEnvId = ''

    beforeEach(() => {
      testEnvId = Math.random() + ''
      next.env['NEXT_PUBLIC_TEST_ID'] = testEnvId
    })

    beforeAll(async () => {
      const manifest = await next.readJSON(
        '.next/cache/shuttle/shuttle-manifest.json'
      )
      initialConfig = manifest.config
    })

    function checkErrorLogs() {
      expect(next.cliOutput).not.toContain('ENOENT')
      expect(next.cliOutput).not.toContain('Failed to detect change')
    }

    async function checkShuttleManifest() {
      const manifest = await next.readJSON(
        '.next/cache/shuttle/shuttle-manifest.json'
      )

      expect(manifest).toEqual({
        nextVersion,
        config: initialConfig,
        gitSha: expect.toBeString(),
      })

      const diagnostics = await next.readJSON(
        '.next/diagnostics/incremental-build-diagnostics.json'
      )

      expect(Array.isArray(diagnostics.changedAppPaths)).toBe(true)
      expect(Array.isArray(diagnostics.unchangedAppPaths)).toBe(true)
      expect(Array.isArray(diagnostics.changedPagePaths)).toBe(true)
      expect(Array.isArray(diagnostics.unchangedPagePaths)).toBe(true)
      expect(typeof diagnostics.currentGitSha).toBe('string')
      expect(typeof diagnostics.shuttleGitSha).toBe('string')
    }

    async function nextStart() {
      // our initial build was built in store-only mode so
      // enable full version in successive builds
      delete next.env['NEXT_PRIVATE_FLYING_SHUTTLE_STORE_ONLY']
      next.env['NEXT_PRIVATE_FLYING_SHUTTLE'] = '1'
      await next.start()
    }

    it('should have file hashes in trace files', async () => {
      const deploymentsTracePath =
        '.next/server/app/dashboard/deployments/[id]/page.js.nft.json'
      const deploymentsTrace = await next.readJSON(deploymentsTracePath)
      const dynamicClientTracePath =
        '.next/server/app/dynamic-client/[category]/[id]/page.js.nft.json'
      const dynamicClientTrace = await next.readJSON(dynamicClientTracePath)
      const indexTracePath = '.next/server/pages/index.js.nft.json'
      const indexTrace = await next.readJSON(indexTracePath)
      const ssgTracePath = '.next/server/pages/ssg.js.nft.json'
      const ssgTrace = await next.readJSON(ssgTracePath)

      expect(deploymentsTrace.fileHashes).toBeTruthy()

      const deploymentsFileHashKeys = Object.keys(deploymentsTrace.fileHashes)
      // ensure the 3 related layouts are included, root, dashboard,
      // and deployments
      expect(
        deploymentsFileHashKeys.filter((item) => item.includes('/layout'))
          .length
      ).toBe(3)

      expect(ssgTrace.fileHashes).toBeTruthy()

      // ensure all files have corresponding fileHashes
      for (const [traceFile, traceFilePath] of [
        [deploymentsTrace, deploymentsTracePath],
        [dynamicClientTrace, dynamicClientTracePath],
        [indexTrace, indexTracePath],
        [ssgTrace, ssgTracePath],
      ]) {
        // ensure client components are included in trace properly
        const isIndexTrace = traceFilePath === indexTracePath
        const isDynamicClientTrace = traceFilePath === dynamicClientTracePath

        if (isIndexTrace || isDynamicClientTrace) {
          const fileHashKeys = Object.keys(traceFile.fileHashes)
          const expectedFiles = [
            'button.js',
            'button.module.css',

            ...(isDynamicClientTrace ? ['global.css', 'style.css'] : []),

            ...(isIndexTrace ? ['shared.module.css'] : []),
          ]
          const foundFiles = fileHashKeys.filter((item) =>
            expectedFiles.some((expectedItem) => item.includes(expectedItem))
          )

          try {
            expect(foundFiles.length).toBe(expectedFiles.length)
          } catch (err) {
            require('console').error(
              traceFilePath,
              'does not include all expected files',
              JSON.stringify(
                {
                  expectedFiles,
                  foundFiles,
                },
                null,
                2
              )
            )
            throw err
          }
        }

        for (const key of traceFile.files) {
          const absoluteKey = path.join(
            next.testDir,
            path.dirname(traceFilePath),
            key
          )
          const stats = await fs.promises.stat(absoluteKey)

          if (
            stats.isSymbolicLink() ||
            stats.isDirectory() ||
            absoluteKey.startsWith(path.join(next.testDir, '.next'))
          ) {
            continue
          }

          expect(typeof traceFile.fileHashes[key]).toBe('string')
        }
      }
    })

    it('should hard navigate on chunk load failure', async () => {
      let blockChunks = false
      const browser = await next.browser('/dashboard', {
        beforePageLoad(page) {
          page.route('**/_next/static/**', async (route: Route) => {
            if (blockChunks) {
              return route.abort()
            }
            return route.continue()
          })
        },
      })

      await retry(async () => {
        expect(await browser.eval('!!next.router.push')).toBe(true)
      })
      blockChunks = true
      await browser.eval('window.beforeNav = 1')
      await browser.eval('next.router.push("/dynamic-client/first/second")')

      await retry(async () => {
        expect(
          await browser.eval('document.documentElement.innerHTML')
        ).toContain('button on app/dynamic-client')
      })
      // since we hard navigate on failure global scope should be cleared
      expect(await browser.eval('window.beforeNav')).toBeFalsy()
    })

    async function checkAppPagesNavigation() {
      // ensure we inlined NEXT_PUBLIC_ properly
      const index$ = await next.render$('/')
      const deployments$ = await next.render$('/dashboard/deployments/123')
      expect(index$('#my-env').text()).toContain(testEnvId)
      expect(index$('#my-other-env').text()).toContain(`${testEnvId}-suffix`)
      expect(deployments$('#my-env').text()).toContain(testEnvId)
      expect(deployments$('#my-other-env').text()).toContain(
        `${testEnvId}-suffix`
      )

      const testPaths = [
        { path: '/', content: 'hello from pages/index', type: 'pages' },
        {
          path: '/blog/123',
          content: 'hello from pages/blog/[slug]',
          type: 'pages',
        },
        {
          path: '/dynamic-client/first/second',
          content: 'button on app/dynamic-client',
          type: 'app',
        },
        {
          path: '/dashboard',
          content: 'hello from app/dashboard',
          type: 'app',
        },
        {
          path: '/dashboard/deployments/123',
          content: 'hello from app/dashboard/deployments/[id]',
          type: 'app',
        },
        {
          path: '/non-existent/path',
          content: 'This page could not be found',
          type: 'app',
          status: 404,
        },
      ]

      for (const testPath of testPaths) {
        const { path, content, status } = testPath
        require('console').error('checking', path)

        const res = await next.fetch(path)
        expect(res.status).toBe(status || 200)

        const browser = await next.browser(path)

        await retry(async () => {
          expect(await browser.eval('!!window.next.router')).toBe(true)
          expect(
            await browser.eval('document.documentElement.innerHTML')
          ).toContain(content)
        })

        if (path === '/' || path === '/dashboard/deployments/123') {
          expect(await browser.elementByCss('#my-env').text()).toContain(
            testEnvId
          )
        }

        const checkNav = async (testPath: (typeof testPaths)[0]) => {
          await browser.eval(`window.next.router.push("${testPath.path}")`)

          await retry(async () => {
            expect(await browser.eval('!!window.next.router')).toBe(true)
            expect(
              await browser.eval('document.documentElement.innerHTML')
            ).toContain(testPath.content)
          })
        }

        // test navigating to a pages path
        const pagesTestPath = testPaths.find(
          (item) => item.type === 'pages' && item.path !== path
        )
        await checkNav(pagesTestPath)

        // go back to initial page
        await checkNav(testPath)

        // test navigating to an app route
        const appTestPath = testPaths.find(
          (item) => item.type === 'app' && item.path !== path
        )
        await checkNav(appTestPath)
      }
    }

    it('should only rebuild just a changed app route correctly', async () => {
      await next.stop()

      const dataPath = 'app/dashboard/deployments/[id]/data.json'
      const originalContent = await next.readFile(dataPath)

      try {
        await next.patchFile(dataPath, JSON.stringify({ hello: 'again' }))
        await nextStart()
        checkErrorLogs()

        expect(next.cliOutput).not.toContain('/not-found')
        expect(next.cliOutput).not.toContain('/catch-all')
        expect(next.cliOutput).not.toContain('/blog/[slug]')
        expect(next.cliOutput).toContain('/dashboard/deployments/[id]')

        await checkShuttleManifest()
        await checkAppPagesNavigation()
      } finally {
        await next.patchFile(dataPath, originalContent)
      }
    })

    it('should only rebuild just a changed pages route correctly', async () => {
      await next.stop()

      const pagePath = 'pages/index.js'
      const originalContent = await next.readFile(pagePath)

      try {
        await next.patchFile(
          pagePath,
          originalContent.replace(
            'hello from pages/index',
            'hello from pages/index!!'
          )
        )
        await nextStart()

        checkErrorLogs()

        expect(next.cliOutput).toContain('/')
        expect(next.cliOutput).not.toContain('/not-found')
        expect(next.cliOutput).not.toContain('/catch-all')
        expect(next.cliOutput).not.toContain('/blog/[slug]')

        await checkShuttleManifest()
        await checkAppPagesNavigation()
      } finally {
        await next.patchFile(pagePath, originalContent)
      }
    })

    it('should only rebuild a changed app and pages route correctly', async () => {
      await next.stop()

      const pagePath = 'pages/index.js'
      const originalPageContent = await next.readFile(pagePath)
      const dataPath = 'app/dashboard/deployments/[id]/data.json'
      const originalDataContent = await next.readFile(dataPath)

      try {
        await next.patchFile(
          pagePath,
          originalPageContent.replace(
            'hello from pages/index',
            'hello from pages/index!!'
          )
        )
        await next.patchFile(dataPath, JSON.stringify({ hello: 'again' }))
        await nextStart()

        checkErrorLogs()

        expect(next.cliOutput).toContain('/')
        expect(next.cliOutput).toContain('/dashboard/deployments/[id]')
        expect(next.cliOutput).not.toContain('/not-found')
        expect(next.cliOutput).not.toContain('/catch-all')
        expect(next.cliOutput).not.toContain('/blog/[slug]')

        await checkShuttleManifest()
        await checkAppPagesNavigation()
      } finally {
        await next.patchFile(pagePath, originalPageContent)
        await next.patchFile(dataPath, originalDataContent)
      }
    })

    it('should rebuild not-found when it changed', async () => {
      await next.stop()

      const dataPath = 'app/not-found.module.css'
      const originalDataContent = await next.readFile(dataPath)

      try {
        await next.patchFile(
          dataPath,
          originalDataContent.replace('cyan', 'pink')
        )
        await nextStart()

        checkErrorLogs()

        const browser = await next.browser('/non-existent/path')
        await retry(async () => {
          expect(
            await browser.eval(
              'getComputedStyle(document.querySelector("p")).color'
            )
          ).toBe('rgb(255, 192, 203)')
        })

        await checkShuttleManifest()
        await checkAppPagesNavigation()
      } finally {
        await next.patchFile(dataPath, originalDataContent)
      }
    })

    it('should have updated middleware on change', async () => {
      await next.stop()

      const dataPath = 'middleware.js'
      const originalDataContent = await next.readFile(dataPath)

      try {
        await next.patchFile(
          dataPath,
          originalDataContent.replace(
            `'x-flying-shuttle': '1'`,
            `'x-flying-shuttle': '2'`
          )
        )
        await nextStart()

        const res = await next.fetch('/flying-shuttle')
        expect(res.headers.get('x-flying-shuttle')).toBe('2')
      } finally {
        await next.patchFile(dataPath, originalDataContent)
      }
    })

    it('should not invalidate on legacy next env but inline properly', async () => {
      await next.stop()

      const dataPath = 'next.config.js'
      const originalDataContent = await next.readFile(dataPath)

      try {
        await next.patchFile(
          dataPath,
          originalDataContent.replace(
            `LEGACY_ENV_KEY: '1'`,
            `LEGACY_ENV_KEY: '2'`
          )
        )
        await nextStart()

        const res = await next.fetch('/legacy-env')
        const html = await res.text()
        const $ = cheerio.load(html)

        expect(res.status).toBe(200)
        expect($('#legacy-env').text()).toBe('2')
      } finally {
        await next.patchFile(dataPath, originalDataContent)
      }
    })
  }
)
