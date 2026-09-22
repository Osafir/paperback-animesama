import {
    BadgeColor,
    Chapter,
    ChapterDetails,
    ContentRating,
    HomeSection,
    PagedResults,
    PartialSourceManga,
    Request,
    Response,
    SearchRequest,
    Source,
    SourceInfo,
    SourceInterceptor,
    SourceIntents,
    SourceManga,
    TagSection,
} from '@paperback/types'
import { ANIME_SAMA_BASE_URL, IMAGE_HEADERS, SCAN_CATALOGUE_QUERY, SOURCE_HEADERS } from './Constants'
import type { ChapterReference, ScanRoute } from './Models'
import { AnimeSamaParser, SearchCard } from './Parser'

export const AnimeSamaInfo: SourceInfo = {
    version: '1.1.0',
    name: 'Anime-Sama',
    icon: 'icon.png',
    author: 'paperback-animesama contributors',
    authorWebsite: 'https://github.com/',
    description: 'Direct Anime-Sama scans in French and available variants.',
    contentRating: ContentRating.MATURE,
    websiteBaseURL: ANIME_SAMA_BASE_URL,
    sourceTags: [
        { text: 'French', type: BadgeColor.GREY },
        { text: 'Scans', type: BadgeColor.GREEN },
    ],
    intents: SourceIntents.MANGA_CHAPTERS | SourceIntents.HOMEPAGE_SECTIONS,
}

class AnimeSamaInterceptor implements SourceInterceptor {
    async interceptRequest(request: Request): Promise<Request> {
        const headers: Record<string, string> = { ...(request.headers ?? {}), ...SOURCE_HEADERS }
        if (request.url.startsWith(`${ANIME_SAMA_BASE_URL}/s2/scans/`)) {
            Object.assign(headers, IMAGE_HEADERS)
        }
        request.headers = headers
        return request
    }

    async interceptResponse(response: Response): Promise<Response> {
        return response
    }
}

export class AnimeSama extends Source {
    requestManager = App.createRequestManager({
        requestsPerSecond: 3,
        requestTimeout: 20_000,
        interceptor: new AnimeSamaInterceptor(),
    })

    private readonly parser = new AnimeSamaParser(this.cheerio)

    async getSearchResults(query: SearchRequest, metadata: { page?: number } | undefined): Promise<PagedResults> {
        const title = query.title?.trim() ?? ''
        const page = metadata?.page ?? 1
        const format = query.includedTags?.find((tag) => tag.id.startsWith('format:'))?.id.slice(7)
        const genres = query.includedTags?.filter((tag) => tag.id.startsWith('genre:')).map((tag) => tag.id.slice(6)) ?? []
        if (format === 'Manhwa' || format === 'Manhua' || format === 'Novel') genres.push(format)
        const url = this.catalogueUrl(page, title, genres)
        const response = await this.get(url)
        const cards = this.parser.parseSearchCards(response)
        const results = format === 'Manga' ? cards.filter((card) => this.isMangaCard(card)) : cards
        return App.createPagedResults({
            results: results.map((card) => this.toPartialSourceManga(card)),
            metadata: this.parser.hasNextPage(response, page) ? { page: page + 1 } : undefined,
        })
    }

    async getHomePageSections(sectionCallback: (section: HomeSection) => void): Promise<void> {
        const [homeHtml, catalogueHtml] = await Promise.all([
            this.get(`${ANIME_SAMA_BASE_URL}/`).catch(() => ''),
            this.get(this.catalogueUrl(1)).catch(() => ''),
        ])
        const latest = this.parser.parseLatestScans(homeHtml)
        const all = this.parser.parseSearchCards(catalogueHtml)
        if (latest.length === 0 && all.length === 0) {
            throw new Error('Anime-Sama did not return any readable scans for the homepage.')
        }

        const lastPage = this.parser.lastCataloguePage(catalogueHtml)
        const discoveryPage = lastPage > 1 ? 2 + Math.floor(Date.now() / 86_400_000) % (lastPage - 1) : 1
        const discoveryHtml = lastPage > 1 ? await this.get(this.catalogueUrl(discoveryPage)).catch(() => '') : catalogueHtml
        const discovery = this.parser.parseSearchCards(discoveryHtml).slice(0, 24)

        for (const [id, title, cards, hasMore] of [
            ['latest', 'Dernières sorties', latest.slice(0, 24), latest.length > 24],
            ['discover', 'À découvrir', discovery, false],
            ['all', 'Tout le catalogue', all.slice(0, 24), this.parser.hasNextPage(catalogueHtml, 1)],
        ] as [string, string, SearchCard[], boolean][]) {
            if (cards.length === 0) continue
            sectionCallback(App.createHomeSection({
                id,
                title,
                type: 'singleRowNormal',
                items: cards.map((card) => this.toPartialSourceManga(card)),
                containsMoreItems: hasMore,
            }))
        }
    }

    async getViewMoreItems(homepageSectionId: string, metadata: { page?: number, offset?: number } | undefined): Promise<PagedResults> {
        if (homepageSectionId === 'latest') {
            const offset = metadata?.offset ?? 24
            const html = await this.get(`${ANIME_SAMA_BASE_URL}/`)
            const latest = this.parser.parseLatestScans(html)
            return App.createPagedResults({
                results: latest.slice(offset, offset + 24).map((card) => this.toPartialSourceManga(card)),
                metadata: offset + 24 < latest.length ? { offset: offset + 24 } : undefined,
            })
        }
        if (homepageSectionId === 'all') {
            const page = metadata?.page ?? 1
            const offset = metadata?.offset ?? 24
            const html = await this.get(this.catalogueUrl(page))
            const cards = this.parser.parseSearchCards(html)
            const next = offset + 24 < cards.length
                ? { page, offset: offset + 24 }
                : this.parser.hasNextPage(html, page) ? { page: page + 1, offset: 0 } : undefined
            return App.createPagedResults({
                results: cards.slice(offset, offset + 24).map((card) => this.toPartialSourceManga(card)),
                metadata: next,
            })
        }
        throw new Error(`Unknown Anime-Sama home section: ${homepageSectionId}`)
    }

    async getSearchTags(): Promise<TagSection[]> {
        const html = await this.get(this.catalogueUrl(1))
        const genreNames = this.parser.parseGenreOptions(html)
        return [
            App.createTagSection({
                id: 'formats',
                label: 'Format',
                tags: [
                    ['Manga', 'Manga'],
                    ['Manhwa', 'Manhwa'],
                    ['Manhua', 'Manhua'],
                    ['Novel', 'Romans adaptés en scans'],
                ].map(([id, label]) => App.createTag({ id: `format:${id}`, label })),
            }),
            App.createTagSection({
                id: 'genres',
                label: 'Genres',
                tags: genreNames.map((label) => App.createTag({ id: `genre:${label}`, label })),
            }),
        ]
    }

    async supportsTagExclusion(): Promise<boolean> {
        return false
    }

    async getMangaDetails(mangaId: string): Promise<SourceManga> {
        const html = await this.get(this.mangaUrl(mangaId))
        const metadata = this.parser.parseMetadata(html)
        if (metadata.title.length === 0) throw new Error('Anime-Sama returned a manga page without a title.')

        const tagSection: TagSection[] = metadata.tags.length === 0 ? [] : [App.createTagSection({
            id: 'genres',
            label: 'Genres',
            tags: metadata.tags.map((label) => App.createTag({ id: label.toLowerCase(), label })),
        })]

        return App.createSourceManga({
            id: mangaId,
            mangaInfo: App.createMangaInfo({
                titles: [metadata.title],
                image: metadata.image,
                desc: metadata.description,
                status: metadata.status,
                author: metadata.author,
                artist: metadata.artist,
                tags: tagSection,
            }),
        })
    }

    async getChapters(mangaId: string): Promise<Chapter[]> {
        const mainPage = await this.get(this.mangaUrl(mangaId))
        const scanRoutes = this.parser.parseScanRoutes(mainPage)
        if (scanRoutes.length === 0) return []

        const groups = await Promise.all(scanRoutes.map((route) => this.getChaptersForRoute(mangaId, route)))
        const unique = new Map<string, Chapter>()
        for (const chapters of groups) {
            for (const chapter of chapters) unique.set(chapter.id, chapter)
        }
        return [...unique.values()].sort((left, right) => left.sortingIndex - right.sortingIndex)
    }

    async getChapterDetails(mangaId: string, chapterId: string): Promise<ChapterDetails> {
        const reference = this.decodeChapterId(chapterId)
        if (reference.mangaId !== mangaId || reference.storageId < 1) {
            throw new Error('Invalid Anime-Sama chapter reference.')
        }

        const response = await this.get(`${ANIME_SAMA_BASE_URL}/s2/scans/get_nb_chap_et_img.php?oeuvre=${encodeURIComponent(reference.workTitle)}`)
        const pageCount = this.parser.parsePageMap(response)[String(reference.storageId)]
        if (pageCount === undefined || pageCount < 1) throw new Error('Anime-Sama chapter has no readable pages.')

        const encodedWorkTitle = encodeURIComponent(reference.workTitle).replace(/%2F/gi, '%252F')
        const pages = Array.from({ length: pageCount }, (_unused, index) => (
            `${ANIME_SAMA_BASE_URL}/s2/scans/${encodedWorkTitle}/${reference.storageId}/${index + 1}.jpg`
        ))
        return App.createChapterDetails({ id: chapterId, mangaId, pages })
    }

    getMangaShareUrl(mangaId: string): string {
        return this.mangaUrl(mangaId)
    }

    private async getChaptersForRoute(mangaId: string, route: ScanRoute): Promise<Chapter[]> {
        const scanUrl = `${this.mangaUrl(mangaId)}${route.path}/`
        const scanPage = await this.get(scanUrl)
        const workTitle = this.parser.parseScanWorkTitle(scanPage)
        if (workTitle.length === 0) return []

        const pageMapBody = await this.get(`${ANIME_SAMA_BASE_URL}/s2/scans/get_nb_chap_et_img.php?oeuvre=${encodeURIComponent(workTitle)}`)
        const pageMap = this.parser.parsePageMap(pageMapBody)
        const chapterNames = this.parser.parseChapterNames(scanPage, pageMap)

        return chapterNames
            .filter((chapter) => pageMap[String(chapter.storageId)] !== undefined)
            .map((chapter) => {
                const reference: ChapterReference = {
                    mangaId,
                    scanPath: route.path,
                    workTitle,
                    storageId: chapter.storageId,
                    displayName: chapter.displayName,
                    langCode: route.langCode,
                }
                return App.createChapter({
                    id: this.encodeChapterId(reference),
                    name: chapter.displayName,
                    chapNum: this.parser.chapterNumber(chapter.displayName, chapter.storageId),
                    sortingIndex: chapter.storageId,
                    langCode: route.langCode,
                    group: route.label,
                })
            })
    }

    private async get(url: string): Promise<string> {
        const response = await this.requestManager.schedule(App.createRequest({ url, method: 'GET' }), 2)
        if (response.status < 200 || response.status >= 300 || response.data === undefined) {
            throw new Error(`Anime-Sama request failed (${response.status}) for ${url}`)
        }
        return response.data
    }

    private mangaUrl(mangaId: string): string {
        const normalized = this.parser.normalizeMangaPath(mangaId)
        if (normalized === undefined) throw new Error('Invalid Anime-Sama manga identifier.')
        return `${ANIME_SAMA_BASE_URL}${normalized}`
    }

    private catalogueUrl(page: number, title = '', genres: string[] = []): string {
        const parameters = [SCAN_CATALOGUE_QUERY, `page=${page}`]
        if (title.length > 0) parameters.push(`search=${encodeURIComponent(title)}`)
        for (const genre of genres) parameters.push(`genre%5B%5D=${encodeURIComponent(genre)}`)
        return `${ANIME_SAMA_BASE_URL}/catalogue/?${parameters.join('&')}`
    }

    private isMangaCard(card: SearchCard): boolean {
        return !card.genres.some((genre) => /^(manhwa|manhua|webcomic)$/i.test(genre))
    }

    private toPartialSourceManga(card: SearchCard): PartialSourceManga {
        return App.createPartialSourceManga({
            mangaId: card.id,
            title: card.title,
            image: card.image,
            subtitle: card.subtitle,
        })
    }

    private encodeChapterId(reference: ChapterReference): string {
        return encodeURIComponent(JSON.stringify(reference))
    }

    private decodeChapterId(chapterId: string): ChapterReference {
        try {
            const parsed: unknown = JSON.parse(decodeURIComponent(chapterId))
            if (parsed === null || typeof parsed !== 'object') throw new Error('Not an object')
            const value = parsed as Record<string, unknown>
            if (
                typeof value.mangaId !== 'string' || typeof value.scanPath !== 'string' ||
                typeof value.workTitle !== 'string' || typeof value.storageId !== 'number' ||
                typeof value.displayName !== 'string' || typeof value.langCode !== 'string'
            ) throw new Error('Malformed chapter properties')
            return {
                mangaId: value.mangaId,
                scanPath: value.scanPath,
                workTitle: value.workTitle,
                storageId: value.storageId,
                displayName: value.displayName,
                langCode: value.langCode,
            }
        } catch {
            throw new Error('Invalid Anime-Sama chapter identifier.')
        }
    }
}
