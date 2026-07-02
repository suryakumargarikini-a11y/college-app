'use strict';
const prisma = require('../services/dbService');
const logger = require('../services/logger');

// GET /api/surveys
const getActive = async (req, res, next) => {
    try {
        const studentId = req.user.id;
        const now = new Date();

        // Find active surveys that haven't expired
        const surveys = await prisma.survey.findMany({
            where: {
                status: 'ACTIVE',
                OR: [
                    { expiresAt: null },
                    { expiresAt: { gt: now } }
                ]
            },
            include: {
                questions: {
                    orderBy: { order: 'asc' }
                },
                responses: {
                    where: { studentId }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        // Filter out surveys the student already responded to
        const activeSurveys = surveys.filter(s => s.responses.length === 0).map(s => {
            // Remove responses list from student view
            const { responses, ...rest } = s;
            return rest;
        });

        res.status(200).json({ success: true, surveys: activeSurveys });
    } catch (err) {
        logger.error(`[Surveys] getActive error: ${err.message}`);
        next(err);
    }
};

// GET /api/surveys/submitted
const getMyResponses = async (req, res, next) => {
    try {
        const studentId = req.user.id;
        const responses = await prisma.surveyResponse.findMany({
            where: { studentId },
            include: {
                survey: {
                    include: {
                        questions: {
                            orderBy: { order: 'asc' }
                        }
                    }
                },
                answers: true
            },
            orderBy: { submittedAt: 'desc' }
        });

        res.status(200).json({ success: true, responses });
    } catch (err) {
        logger.error(`[Surveys] getMyResponses error: ${err.message}`);
        next(err);
    }
};

// GET /api/surveys/:id
const getById = async (req, res, next) => {
    try {
        const { id } = req.params;
        const studentId = req.user.id;

        const survey = await prisma.survey.findUnique({
            where: { id },
            include: {
                questions: {
                    orderBy: { order: 'asc' }
                },
                responses: {
                    where: { studentId }
                }
            }
        });

        if (!survey) {
            return res.status(404).json({ success: false, message: 'Survey not found' });
        }

        // Check if expired
        if (survey.status !== 'ACTIVE' || (survey.expiresAt && survey.expiresAt < new Date())) {
            return res.status(400).json({ success: false, message: 'Survey is closed or expired' });
        }

        const hasSubmitted = survey.responses.length > 0;
        const { responses, ...rest } = survey;

        res.status(200).json({
            success: true,
            survey: rest,
            hasSubmitted
        });
    } catch (err) {
        logger.error(`[Surveys] getById error: ${err.message}`);
        next(err);
    }
};

// POST /api/surveys/:id/submit
const submit = async (req, res, next) => {
    try {
        const { id } = req.params;
        const studentId = req.user.id;
        const { answers } = req.body; // Array of { questionId, answer }

        if (!answers || !Array.isArray(answers)) {
            return res.status(400).json({ success: false, message: 'Answers are required' });
        }

        const survey = await prisma.survey.findUnique({
            where: { id },
            include: {
                questions: true,
                responses: {
                    where: { studentId }
                }
            }
        });

        if (!survey) {
            return res.status(404).json({ success: false, message: 'Survey not found' });
        }

        // Validate state
        if (survey.status !== 'ACTIVE' || (survey.expiresAt && survey.expiresAt < new Date())) {
            return res.status(400).json({ success: false, message: 'Survey is closed or expired' });
        }

        if (survey.responses.length > 0) {
            return res.status(400).json({ success: false, message: 'You have already submitted this survey' });
        }

        // Validate all questions answered
        const questionIds = survey.questions.map(q => q.id);
        const answeredIds = answers.map(a => a.questionId);
        const missing = questionIds.filter(qid => !answeredIds.includes(qid));
        if (missing.length > 0) {
            return res.status(400).json({ success: false, message: 'Please answer all questions' });
        }

        // Create response in transaction
        const result = await prisma.$transaction(async (tx) => {
            const response = await tx.surveyResponse.create({
                data: {
                    surveyId: id,
                    studentId
                }
            });

            await tx.surveyAnswer.createMany({
                data: answers.map(a => ({
                    responseId: response.id,
                    questionId: a.questionId,
                    answer: String(a.answer)
                }))
            });

            return response;
        });

        logger.info(`[Surveys] Student ${studentId} submitted response for survey ${id}`);

        res.status(201).json({
            success: true,
            message: 'Survey submitted successfully',
            responseId: result.id
        });
    } catch (err) {
        logger.error(`[Surveys] submit error: ${err.message}`);
        next(err);
    }
};

module.exports = { getActive, getMyResponses, getById, submit };
