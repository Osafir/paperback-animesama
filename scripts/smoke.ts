import { load } from 'cheerio'
import { ANIME_SAMA_BASE_URL, SCAN_CATALOGUE_QUERY } from '../src/AnimeSama/Constants'
import { AnimeSamaParser } from '../src/AnimeSama/Parser'

interface SmokeResult {
    query: string
    title: string
    chapters: number
    firstChapterPages: number
    firstImageStatus: number
}

const parser = new AnimeSamaParser(load(''))
const headers = {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'fr-FR,fr;q=0.9',
}

async function fetchText(url: string, extraHeaders: Record<string, string> = {}): Promise<string> {
    const response = await fetch(url, { headers: { ...headers, ...extraHeaders } })
    if (!response.ok) throw new Error(`${response.status} for ${url}`)
    return response.text()
}

async function verifyQuery(query: string): Promise<SmokeResult> {
    const searchPage = await fetchText(`${ANIME_SAMA_BASE_URL}/catalogue?${SCAN_CATALOGUE_QUERY}&search=${encodeURIComponent(query)}&page=1`)
    const firstResult = parser.parseSearchCards(searchPage)[0]
    if (firstResult === undefined) throw new Error(`No scan result for ${query}`)

    const mangaPage = await fetchText(`${ANIME_SAMA_BASE_URL}${firstResult.id}`)
    const metadata = parser.parseMetadata(mangaPage)
    if (metadata.title.length === 0) throw new Error(`Missing title for ${query}`)

    const route = parser.parseScanRoutes(mangaPage)[0]
    if (route === undefined) throw new Error(`No scan route for ${metadata.title}`)
    const scanPage = await fetchText(`${ANIME_SAMA_BASE_URL}${firstResult.id}${route.path}/`)
    const workTitle = parser.parseScanWorkTitle(scanPage)
    const pageMap = parser.parsePageMap(await fetchText(`${ANIME_SAMA_BASE_URL}/s2/scans/get_nb_chap_et_img.php?oeuvre=${encodeURIComponent(workTitle)}`))
    const chapters = parser.parseChapterNames(scanPage, pageMap).filter((chapter) => pageMap[String(chapter.storageId)] !== undefined)
    const firstChapter = chapters[0]
    if (firstChapter === undefined) throw new Error(`No readable chapters for ${metadata.title}`)
    const pageCount = pageMap[String(firstChapter.storageId)]
    if (pageCount === undefined || pageCount < 1) throw new Error(`No pages for ${metadata.title}`)

    const imageUrl = `${ANIME_SAMA_BASE_URL}/s2/scans/${encodeURIComponent(workTitle)}/${firstChapter.storageId}/1.jpg`
    const imageResponse = await fetch(imageUrl, { headers: { ...headers, Referer: `${ANIME_SAMA_BASE_URL}/` } })
    if (!imageResponse.ok) throw new Error(`First image returned ${imageResponse.status} for ${metadata.title}`)

    return {
        query,
        title: metadata.title,
        chapters: chapters.length,
        firstChapterPages: pageCount,
        firstImageStatus: imageResponse.status,
    }
}

async function main(): Promise<void> {
    const results = await Promise.all(['Frieren', 'One Piece', 'Dandadan'].map(verifyQuery))
    console.table(results)
}

main().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
})
