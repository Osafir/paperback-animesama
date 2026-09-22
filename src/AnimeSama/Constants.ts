export const ANIME_SAMA_BASE_URL = 'https://anime-sama.to'

export const SOURCE_HEADERS: Record<string, string> = {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'fr-FR,fr;q=0.9',
}

export const IMAGE_HEADERS: Record<string, string> = {
    Referer: `${ANIME_SAMA_BASE_URL}/`,
}

export const SCAN_CATALOGUE_QUERY = 'type%5B%5D=Scans'

