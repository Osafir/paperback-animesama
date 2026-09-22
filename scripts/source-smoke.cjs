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
    createSourceManga: (info) => info,
    createMangaInfo: (info) => info,
    createChapter: (info) => info,
    createChapterDetails: (info) => info,
}

async function main() {
    const { Sources } = require('../bundles/AnimeSama/source.js')
    const source = new Sources.AnimeSama(load(''))
    const sections = []
    await source.getHomePageSections((section) => sections.push(section))
    const homeItems = sections.at(-1)?.items ?? []
    if (homeItems.length === 0) throw new Error('Source homepage returned no scan cards')
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
        homeItems: homeItems.length,
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
