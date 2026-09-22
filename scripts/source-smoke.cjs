const { load } = require('cheerio')

global.App = {
    createRequestManager: ({ interceptor }) => ({
        schedule: async (request) => {
            const intercepted = await interceptor.interceptRequest(request)
            const response = await fetch(intercepted.url, { headers: intercepted.headers })
            return {
                status: response.status,
                data: await response.text(),
                headers: {},
                request: intercepted,
            }
        },
    }),
    createRequest: (info) => ({ headers: {}, cookies: [], ...info }),
    createPagedResults: (info) => info,
    createHomeSection: (info) => ({ items: [], ...info }),
    createPartialSourceManga: (info) => info,
    createTagSection: (info) => info,
    createTag: (info) => info,
    createSearchField: (info) => info,
    createSourceManga: (info) => info,
    createMangaInfo: (info) => info,
    createChapter: (info) => info,
    createChapterDetails: (info) => info,
}

async function main() {
    const { Sources } = require('../bundles/AnimeSama/source.js')
    const source = new Sources.AnimeSama(load(''))
    const catalogue = await (await fetch('https://anime-sama.to/catalogue/?type%5B%5D=Scans&page=1')).text()
    const originalUrl = global.URL
    global.URL = undefined
    const urlIndependentCards = source.parser.parseSearchCards(catalogue)
    global.URL = originalUrl
    if (urlIndependentCards.length === 0) throw new Error('Catalogue parser depends on the URL global')
    const sections = []
    await source.getHomePageSections((section) => sections.push(section))
    const latest = sections.find((section) => section.id === 'latest')?.items ?? []
    const discover = sections.find((section) => section.id === 'discover')?.items ?? []
    const all = sections.find((section) => section.id === 'all')?.items ?? []
    if (latest.length === 0 || discover.length === 0 || all.length === 0) {
        throw new Error('Source homepage returned an empty section')
    }
    const moreAll = await source.getViewMoreItems('all', undefined)
    if (moreAll.results.length === 0) throw new Error('All catalogue pagination is empty')
    if (moreAll.results[0].mangaId === all[0].mangaId) throw new Error('All catalogue pagination repeated the first card')
    const tags = await source.getSearchTags()
    if (!tags.some((section) => section.label === 'Format') || !tags.some((section) => section.label === 'Genres')) {
        throw new Error('Source search filters are missing')
    }
    const manhwa = await source.getSearchResults({ title: '', includedTags: [{ id: 'format:Manhwa' }] }, undefined)
    if (manhwa.results.length === 0) throw new Error('Manhwa filter returned no results')
    const search = await source.getSearchResults({ title: 'Frieren' }, undefined)
    const result = search.results[0]
    if (result === undefined) throw new Error('Source returned no result for Frieren')

    const details = await source.getMangaDetails(result.mangaId)
    const chapters = await source.getChapters(result.mangaId)
    const chapter = chapters[0]
    if (chapter === undefined) throw new Error('Source returned no chapters for Frieren')

    const chapterDetails = await source.getChapterDetails(result.mangaId, chapter.id)
    const firstPage = chapterDetails.pages[0]
    if (firstPage === undefined) throw new Error('Source returned no pages for Frieren')
    const imageResponse = await fetch(firstPage, { headers: { Referer: 'https://anime-sama.to/' } })
    if (!imageResponse.ok) throw new Error(`Source first image returned ${imageResponse.status}`)

    console.table([{
        result: result.title,
        latest: latest.length,
        discover: discover.length,
        all: all.length,
        moreAll: moreAll.results.length,
        manhwa: manhwa.results.length,
        title: details.mangaInfo.titles[0],
        chapters: chapters.length,
        pages: chapterDetails.pages.length,
        firstImageStatus: imageResponse.status,
        language: chapter.langCode,
    }])
}

main().catch((error) => {
    console.error(error)
    process.exitCode = 1
})
