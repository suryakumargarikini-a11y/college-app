/**
 * Academic Module V2 Data Contracts & DTOs
 */

/**
 * @typedef {Object} SubjectDTO
 * @property {string} code
 * @property {string} name
 * @property {string} grade
 * @property {string} credits
 * @property {string} type
 * @property {string} [internalMarks]
 * @property {string} [externalMarks]
 * @property {string} [totalMarks]
 * @property {string} [result]
 */

/**
 * @typedef {Object} SemesterDTO
 * @property {string} semester
 * @property {string} semesterName
 * @property {string} sgpa
 * @property {string} creditsEarned
 * @property {string} totalCredits
 * @property {SubjectDTO[]} subjects
 */

/**
 * @typedef {Object} OverallSummaryDTO
 * @property {string} cgpa
 * @property {string} sgpa
 * @property {string} percentage
 * @property {string} totalCredits
 * @property {string} registeredCredits
 * @property {string} status
 */

/**
 * @typedef {Object} AcademicHistoryDTO
 * @property {OverallSummaryDTO} overall
 * @property {SemesterDTO[]} semesters
 * @property {string} [updatedAt]
 */

module.exports = {};
