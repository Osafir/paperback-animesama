export interface ScanRoute {
    path: string
    label: string
    langCode: string
}

export interface ChapterReference {
    mangaId: string
    scanPath: string
    workTitle: string
    storageId: number
    displayName: string
    langCode: string
}

export interface ScanPageMap {
    [storageId: string]: number
}

