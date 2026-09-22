import {
    BadgeColor,
    Chapter,
    ChapterDetails,
    ContentRating,
    PagedResults,
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
import { AnimeSamaParser } from './Parser'

export const AnimeSamaInfo: SourceInfo = {
    version: '1.0.0',
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
    intents: SourceIntents.MANGA_CHAPTERS,
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

    async getSearchResults(query: SearchRequest, _metadata: unknown | undefined): Promise<PagedResults> {
        const title = query.title?.trim() ?? ''
        if (title.length === 0) return App.createPagedResults({ results: [] })

        const response = await this.get(`${ANIME_SAMA_BASE_URL}/catalogue?${SCAN_CATALOGUE_QUERY}&search=${encodeURIComponent(title)}&page=1`)
        const cards = this.parser.parseSearchCards(response)
        return App.createPagedResults({
            results: cards.map((card) => App.createPartialSourceManga({
                mangaId: card.id,
                title: card.title,
                image: card.image,
            })),
        })
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
