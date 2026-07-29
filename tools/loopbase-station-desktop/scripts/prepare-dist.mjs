import { cpSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const dist = join(root, 'dist')

rmSync(dist, { recursive: true, force: true })
mkdirSync(join(dist, 'src'), { recursive: true })
cpSync(join(root, 'index.html'), join(dist, 'index.html'))
cpSync(join(root, 'src'), join(dist, 'src'), { recursive: true })
