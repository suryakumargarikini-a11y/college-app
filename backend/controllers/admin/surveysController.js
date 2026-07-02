'use strict';
const prisma = require('../../services/dbService');
const logger = require('../../services/logger');
const { auditLogRepository } = require('../../repositories/index');

const getAll = async (req, res, next) => {
    try {
        const surveys = await prisma.survey.findMany({
            include: {
                _count: {
                    select: { responses: true }
                },
                questions: {
                    orderBy: { order: 'asc' }
                }
            },
            orderBy: { createdAt: 'desc' }
        });
        res.json(surveys);
    } catch (err) {
        logger.error(`[Admin Surveys] getAll error: ${err.message}`);
        res.status(500).json({ error: 'Failed to fetch surveys' });
    }
};

const create = async (req, res, next) => {
    try {
        const { title, description, status = 'ACTIVE', isAnonymous = false, expiresAt, questions } = req.body;
        if (!title || !description || !questions || !Array.isArray(questions)) {
            return res.status(400).json({ error: 'Title, description, and questions are required' });
        }

        const survey = await prisma.$transaction(async (tx) => {
            const newSurvey = await tx.survey.create({
                data: {
                    title,
                    description,
                    status,
                    isAnonymous,
                    expiresAt: expiresAt ? new Date(expiresAt) : null,
                    createdBy: req.admin.email
                }
            });

            if (questions.length > 0) {
                await tx.surveyQuestion.createMany({
                    data: questions.map((q, idx) => ({
                        surveyId: newSurvey.id,
                        text: q.text,
                        type: q.type, // MCQ, RATING, TEXT
                        options: q.options ? JSON.stringify(q.options) : null,
                        order: q.order !== undefined ? q.order : idx
                    }))
                });
            }

            return newSurvey;
        });

        logger.info(`[Admin Surveys] Created: ${title} by admin ${req.admin.email}`);
        await auditLogRepository.log(null, 'SURVEY_CREATED', `Survey '${title}' created by admin ${req.admin.email}`, req.admin.id, 'INFO');

        res.status(201).json(survey);
    } catch (err) {
        logger.error(`[Admin Surveys] create error: ${err.message}`);
        res.status(500).json({ error: 'Failed to create survey' });
    }
};

const update = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { title, description, status, isAnonymous, expiresAt } = req.body;

        const survey = await prisma.survey.update({
            where: { id },
            data: {
                ...(title && { title }),
                ...(description && { description }),
                ...(status && { status }),
                ...(isAnonymous !== undefined && { isAnonymous }),
                ...(expiresAt !== undefined && { expiresAt: expiresAt ? new Date(expiresAt) : null })
            }
        });

        res.json(survey);
    } catch (err) {
        logger.error(`[Admin Surveys] update error: ${err.message}`);
        res.status(500).json({ error: 'Failed to update survey' });
    }
};

const remove = async (req, res, next) => {
    try {
        await prisma.survey.delete({ where: { id: req.params.id } });
        res.json({ success: true });
    } catch (err) {
        logger.error(`[Admin Surveys] remove error: ${err.message}`);
        res.status(500).json({ error: 'Failed to delete survey' });
    }
};

const getResponses = async (req, res, next) => {
    try {
        const { id } = req.params;
        const survey = await prisma.survey.findUnique({
            where: { id },
            include: {
                questions: {
                    orderBy: { order: 'asc' }
                }
            }
        });

        if (!survey) {
            return res.status(404).json({ error: 'Survey not found' });
        }

        const responses = await prisma.surveyResponse.findMany({
            where: { surveyId: id },
            include: {
                student: {
                    select: {
                        name: true,
                        roll: true,
                        email: true
                    }
                },
                answers: true
            },
            orderBy: { submittedAt: 'desc' }
        });

        // Strip student identity if survey is anonymous
        const sanitizedResponses = responses.map(r => {
            if (survey.isAnonymous) {
                return {
                    id: r.id,
                    surveyId: r.surveyId,
                    submittedAt: r.submittedAt,
                    student: {
                        name: 'Anonymous Student',
                        roll: 'XXXXXXXXXX',
                        email: 'anonymous@sitam.edu'
                    },
                    answers: r.answers
                };
            }
            return r;
        });

        res.json(sanitizedResponses);
    } catch (err) {
        logger.error(`[Admin Surveys] getResponses error: ${err.message}`);
        res.status(500).json({ error: 'Failed to fetch responses' });
    }
};

module.exports = { getAll, create, update, remove, getResponses };
