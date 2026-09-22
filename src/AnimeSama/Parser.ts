import type { CheerioAPI } from 'cheerio'
import { ANIME_SAMA_BASE_URL } from './Constants'
import type { ScanPageMap, ScanRoute } from './Models'

const SCAN_ROUTE_PATTERN = /panneauScan\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*\)/g
const LIST_COMMAND_PATTERN = /\b(creerListe|newSP|newSPF|finirListe|resetListe)\s*\(([^)]*)\)/g
const NUMERIC_RANGE_PATTERN = /^\s*(\d+)\s*,\s*(\d+)\s*$/
const CHAPTER_NUMBER_PATTERN = /(?:chapitre\s+)?(\d+(?:\.\d+)?)/i

export interface ParsedMangaMetadata {
    title: string
    image: string
    description: string
    status: string
    author: string
    artist: string
    tags: string[]
}

export interface SearchCard {
    id: string
    title: string
    image: string
}

export interface NamedChapter {
    storageId: number
    displayName: string
}

export class AnimeSamaParser {
    constructor(private readonly cheerio: CheerioAPI) {}

    parseSearchCards(html: string): SearchCard[] {
        const $ = this.cheerio.load(html)
        const cards = new Map<string, SearchCard>()

        $('#list_catalog > div, #list_catalog article, #list_catalog .card').each((_index, card) => {
            const anchor = $(card).find('a[href*="/catalogue/"]').first()
            const href = anchor.attr('href')
            const title = this.textOrEmpty($(card).find('h2.card-title, h2, h3').first())
            if (href === undefined || title.length === 0) return

            const id = this.normalizeMangaPath(href)
            if (id === undefined) return

            cards.set(id, {
                id,
                title,
                image: this.absoluteUrl($(card).find('img').first().attr('src')),
            })
        })

        return [...cards.values()]
    }

    parseMetadata(html: string): ParsedMangaMetadata {
        const $ = this.cheerio.load(html)
        const title = this.textOrEmpty($('#titreOeuvre, div.my-2 h1, h1').first())
        const description = this.textOrEmpty($('#synopsisText, .synopsis, [itemprop="description"]').first())
        const image = this.absoluteUrl($('#coverOeuvre, #imgOeuvre, img[itemprop="image"]').first().attr('src'))
        const tags = $('.genre-pill').map((_index, tag) => this.textOrEmpty($(tag))).get().filter(Boolean)

        return {
            title,
            image,
            description,
            status: this.findLabeledValue($, ['état', 'statut']),
            author: this.findLabeledValue($, ['créateur', 'auteur', 'author']),
            artist: this.findLabeledValue($, ['artiste', 'artist']),
            tags,
        }
    }

    parseScanRoutes(html: string): ScanRoute[] {
        const routes = new Map<string, ScanRoute>()
        for (const match of html.matchAll(SCAN_ROUTE_PATTERN)) {
            const label = match[1]?.trim() ?? ''
            const rawPath = match[2]?.trim() ?? ''
            const path = this.normalizeScanPath(rawPath)
            if (path === undefined) continue

            const normalizedLabel = label.toLowerCase()
            const langCode = /\bvf\b|fran[çc]ais/i.test(normalizedLabel + path) ? 'fr' : 'en'
            routes.set(path, { path, label, langCode })
        }
        return [...routes.values()]
    }

    parseScanWorkTitle(html: string): string {
        const $ = this.cheerio.load(html)
        return this.textOrEmpty($('#titreOeuvre, h1').first())
    }

    parsePageMap(body: string): ScanPageMap {
        let candidate: unknown
        try {
            candidate = JSON.parse(body) as unknown
        } catch {
            return {}
        }
        if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) return {}

        const pages: ScanPageMap = {}
        for (const [key, value] of Object.entries(candidate as Record<string, unknown>)) {
            const pageCount = typeof value === 'number' ? value : Number(value)
            if (/^\d+$/.test(key) && Number.isFinite(pageCount) && pageCount > 0) {
                pages[key] = Math.floor(pageCount)
            }
        }
        return pages
    }

    parseChapterNames(html: string, pageMap: ScanPageMap): NamedChapter[] {
        const totalStoredChapters = Object.keys(pageMap).length
        if (totalStoredChapters === 0) return []

        const commands = [...html.matchAll(LIST_COMMAND_PATTERN)]
        if (commands.length === 0) return this.defaultChapterNames(totalStoredChapters)

        const chapters: string[] = []
        let specialCount = 0
        let hasEffectiveCommand = false

        for (const command of commands) {
            const name = command[1]
            const args = command[2]?.trim() ?? ''
            if (name === 'resetListe') {
                chapters.length = 0
                specialCount = 0
                hasEffectiveCommand = true
                continue
            }
            if (name === 'creerListe') {
                const range = args.match(NUMERIC_RANGE_PATTERN)
                if (range === null) continue
                const start = Number(range[1])
                const end = Number(range[2])
                if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) continue
                for (let number = start; number <= end; number += 1) chapters.push(`Chapitre ${number}`)
                hasEffectiveCommand = true
                continue
            }
            if (name === 'newSP' || name === 'newSPF') {
                const special = this.parseSpecialArgument(args)
                if (special.length === 0) continue
                chapters.push(name === 'newSP' ? `Chapitre ${special}` : special)
                specialCount += 1
                hasEffectiveCommand = true
                continue
            }
            if (name === 'finirListe' && /^\d+$/.test(args)) {
                const start = Number(args)
                const end = totalStoredChapters - specialCount
                if (Number.isSafeInteger(start) && start <= end) {
                    for (let number = start; number <= end; number += 1) chapters.push(`Chapitre ${number}`)
                    hasEffectiveCommand = true
                }
            }
        }

        if (!hasEffectiveCommand || chapters.length === 0) return this.defaultChapterNames(totalStoredChapters)
        return chapters.map((displayName, index) => ({ storageId: index + 1, displayName }))
    }

    chapterNumber(displayName: string, fallback: number): number {
        const match = displayName.match(CHAPTER_NUMBER_PATTERN)
        const parsed = Number(match?.[1])
        return Number.isFinite(parsed) ? parsed : fallback
    }

    absoluteUrl(value: string | undefined): string {
        if (value === undefined || value.trim().length === 0) return ''
        try {
            return new URL(value, ANIME_SAMA_BASE_URL).toString()
        } catch {
            return ''
        }
    }

    normalizeMangaPath(value: string): string | undefined {
        try {
            const url = new URL(value, ANIME_SAMA_BASE_URL)
            if (url.origin !== ANIME_SAMA_BASE_URL || !url.pathname.startsWith('/catalogue/')) return undefined
            return `${url.pathname.replace(/\/scan\/[^/]+\/?$/, '/').replace(/\/+$/, '')}/`
        } catch {
            return undefined
        }
    }

    private normalizeScanPath(value: string): string | undefined {
        const trimmed = value.trim().replace(/^\/+|\/+$/g, '')
        if (!/^scan\/[^/]+$/i.test(trimmed)) return undefined
        return trimmed.toLowerCase()
    }

    private defaultChapterNames(total: number): NamedChapter[] {
        return Array.from({ length: total }, (_unused, index) => ({
            storageId: index + 1,
            displayName: `Chapitre ${index + 1}`,
        }))
    }

    private parseSpecialArgument(value: string): string {
        const quoted = value.match(/^\s*["'](.+)["']\s*$/)
        return (quoted?.[1] ?? value).trim()
    }

    private findLabeledValue($: CheerioAPI, labels: string[]): string {
        let value = ''
        $('.info-lbl').each((_index, label) => {
            if (value.length > 0) return
            const labelText = this.textOrEmpty($(label)).toLowerCase()
            if (!labels.some((expected) => labelText.includes(expected))) return
            value = this.textOrEmpty($(label).next('.info-val'))
            if (value.length === 0) value = this.textOrEmpty($(label).parent().find('.info-val').first())
        })
        return value
    }

    private textOrEmpty(element: ReturnType<CheerioAPI>): string {
        return element.text().replace(/\s+/g, ' ').trim()
    }
}

