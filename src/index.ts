export {
  lookupCompany,
  validateCompanyNumber,
  searchCompany,
  normalizeNumber,
  datasetInfo,
  type CompanyNumberResult,
  type CompanyLookupResult,
  type CompanySearchResult,
  type CompanySearchHit,
} from "./company.js";
export { downloadAndCache, getDataset, resetDataset, cacheFile, DATA_URL_DEFAULT, type CompanyRecord } from "./data.js";
