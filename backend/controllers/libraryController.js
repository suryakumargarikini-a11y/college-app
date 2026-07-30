'use strict';
const fs = require('fs');
const prisma = require('../services/dbService');
const storage = require('../services/libraryStorage');
const logger = require('../services/logger');
const staffScopeService = require('../services/staffScopeService');

const TYPES = {
    '.pdf': ['application/pdf'],
    '.ppt': ['application/vnd.ms-powerpoint'],
    '.pptx': ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    '.doc': ['application/msword'],
    '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    '.xls': ['application/vnd.ms-excel'],
    '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    '.png': ['image/png'],
    '.jpg': ['image/jpeg'],
    '.jpeg': ['image/jpeg'],
    '.gif': ['image/gif']
};

const MAX_BYTES = Number(process.env.LIBRARY_MAX_UPLOAD_BYTES || 25 * 1024 * 1024);

const nil = v => (v == null || String(v).trim() === '' || String(v).toUpperCase() === 'ALL') ? null : String(v).trim();

function data(b) {
    return {
        title: String(b.title || '').trim(),
        description: nil(b.description),
        category: String(b.category || 'GENERAL').trim().toUpperCase(),
        subject: nil(b.subject),
        branch: nil(b.branch),
        semester: nil(b.semester),
        section: nil(b.section),
        academicYear: nil(b.academicYear)
    };
}

function getYearAliases(rawYear, rawAcadYear) {
    const set = new Set();
    if (rawYear) set.add(String(rawYear).trim());
    if (rawAcadYear) set.add(String(rawAcadYear).trim());

    const str = `${rawYear || ''} ${rawAcadYear || ''}`;
    const match = str.match(/\b([1-4])\b/) || str.match(/([1-4])/);
    if (match) {
        const d = match[1];
        set.add(d);
        set.add(`Year ${d}`);
        set.add(`${d}nd Year`);
        set.add(`${d}st Year`);
        set.add(`${d}rd Year`);
        set.add(`${d}th Year`);
        if (d === '1') { set.add('1st Year'); set.add('1st'); set.add('I'); }
        if (d === '2') { set.add('2nd Year'); set.add('2nd'); set.add('II'); }
        if (d === '3') { set.add('3rd Year'); set.add('3rd'); set.add('III'); }
        if (d === '4') { set.add('4th Year'); set.add('4th'); set.add('IV'); }
    }
    return Array.from(set);
}

function getSemesterAliases(rawSem) {
    const set = new Set();
    if (rawSem) set.add(String(rawSem).trim());

    const str = String(rawSem || '');
    let num = null;
    const matchDigit = str.match(/\b([1-8])\b/);
    if (matchDigit) {
        num = parseInt(matchDigit[1], 10);
    } else {
        if (str.includes('I Semester') || str.includes('Semester I') || str.includes('I Sem')) num = 1;
        else if (str.includes('II Semester') || str.includes('Semester II') || str.includes('II Sem')) num = 2;
        else if (str.includes('III Semester') || str.includes('Semester III') || str.includes('III Sem')) num = 3;
        else if (str.includes('IV Semester') || str.includes('Semester IV') || str.includes('IV Sem')) num = 4;
        else if (str.includes('V Semester') || str.includes('Semester V') || str.includes('V Sem')) num = 5;
        else if (str.includes('VI Semester') || str.includes('Semester VI') || str.includes('VI Sem')) num = 6;
        else if (str.includes('VII Semester') || str.includes('Semester VII') || str.includes('VII Sem')) num = 7;
        else if (str.includes('VIII Semester') || str.includes('Semester VIII') || str.includes('VIII Sem')) num = 8;
    }

    if (num) {
        const s = String(num);
        set.add(s);
        set.add(`Sem ${s}`);
        set.add(`Semester ${s}`);
        set.add(`${s}st`);
        set.add(`${s}nd`);
        set.add(`${s}rd`);
        set.add(`${s}th`);
        set.add(`${s}st Semester`);
        set.add(`${s}nd Semester`);
        set.add(`${s}rd Semester`);
        set.add(`${s}th Semester`);
        const romans = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
        if (romans[num]) {
            set.add(`${romans[num]} Semester`);
            set.add(`${romans[num]} Sem`);
        }
    }
    return Array.from(set);
}

function allowed(m, s) {
    if (!m || !s) return false;
    if (m.expiresAt && new Date(m.expiresAt) < new Date()) return false;

    // 1. Branch match
    if (!m.branch) return false;
    const branchMatch = s.branch && staffScopeService.canonicalizeBranch(m.branch) === staffScopeService.canonicalizeBranch(s.branch);
    if (!branchMatch) return false;

    // 2. Year match
    const targetYr = m.academicYear || m.year;
    if (!targetYr) return false;
    const yearAliases = getYearAliases(s.year, s.academicYear);
    const yearMatch = yearAliases.includes(String(targetYr).trim());
    if (!yearMatch) return false;

    // 3. Semester match
    if (!m.semester) return false;
    const semAliases = getSemesterAliases(s.semester);
    const semMatch = semAliases.includes(String(m.semester).trim());
    if (!semMatch) return false;

    // 4. Section match
    if (!m.section) return false;
    const secMatch = String(m.section).trim().toUpperCase() === String(s.section).trim().toUpperCase();
    if (!secMatch) return false;

    return true;
}

async function notify(m) {
    try {
        const w = {};
        if (m.branch) {
            const aliases = staffScopeService.getRawAliasesForCanonicals([staffScopeService.canonicalizeBranch(m.branch)]);
            w.branch = { in: aliases };
        }
        if (m.semester) w.semester = m.semester;
        if (m.section)  w.section  = m.section;
        if (m.academicYear) w.OR = [{ academicYear: m.academicYear }, { year: m.academicYear }];

        const ss = await prisma.student.findMany({ where: w, select: { id: true } });
        await prisma.notification.createMany({
            data: ss.map(s => ({
                studentId: s.id,
                title: `New ${m.subject || 'E-Library'} material uploaded: ${m.title}`,
                message: 'Open E-Library to view or download it.',
                type: 'library',
                category: 'update',
                date: new Date().toISOString(),
                metadata: JSON.stringify({ materialId: m.id })
            })),
            skipDuplicates: true
        });
    } catch (e) {
        logger.warn(`[Library] notification delivery failed: ${e.message}`);
    }
}

async function upload(req, res, next) {
    try {
        if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'A file body is required.' });
        if (req.body.length > MAX_BYTES) return res.status(413).json({ error: 'File exceeds upload limit.' });

        const originalFileName = storage.safeName(req.headers['x-file-name']);
        const ext = storage.extension(originalFileName);
        if (!TYPES[ext]) return res.status(400).json({ error: 'Unsupported file extension.' });

        const detected = storage.detectType(req.body, ext);
        if (!detected) return res.status(400).json({ error: 'File signature does not match a supported academic file.' });

        if (!TYPES[ext].includes(req.headers['content-type']) && req.headers['content-type'] !== 'application/octet-stream') {
            return res.status(400).json({ error: 'Declared MIME type does not match extension.' });
        }

        const d = data(req.query);
        if (!d.title) return res.status(400).json({ error: 'title is required.' });
        if (!d.branch) return res.status(400).json({ error: 'Target Branch is required' });
        if (!d.academicYear) return res.status(400).json({ error: 'Target Year is required' });
        if (!d.semester) return res.status(400).json({ error: 'Target Semester is required' });
        if (!d.section) return res.status(400).json({ error: 'Target Section is required' });

        // ── ATOMIC STAFF SCOPE VALIDATION ──────────────────────────────────────────
        const admin = req.admin;
        if (d.branch && admin && admin.role !== 'SUPER_ADMIN') {
            const { canonicals } = await staffScopeService.getAuthorizedDepartments(admin);
            const targetCanon = staffScopeService.canonicalizeBranch(d.branch);
            if (!canonicals.includes(targetCanon)) {
                return res.status(403).json({
                    error: `Forbidden: Staff member '${admin.email || admin.id}' lacks authorization to target department '${d.branch}' (canonical: '${targetCanon}')`
                });
            }
        }
        // ─────────────────────────────────────────────────────────────────────────

        const stored = await storage.save(req.body, originalFileName);

        let m = await prisma.libraryMaterial.create({
            data: {
                ...d,
                ...stored,
                originalFileName,
                fileType: ext.slice(1).toUpperCase(),
                mimeType: detected,
                fileSize: req.body.length,
                uploadedBy: admin ? admin.email : 'system',
                uploadedByRole: admin ? admin.role : 'SUPER_ADMIN'
            }
        });

        m = await prisma.libraryMaterial.update({
            where: { id: m.id },
            data: { fileUrl: `/api/library/materials/${m.id}/content` }
        });

        setImmediate(() => notify(m));
        res.status(201).json({ success: true, material: m });
    } catch (e) {
        next(e);
    }
}

async function studentList(req, res, next) {
    try {
        const s = await prisma.student.findUnique({ where: { id: req.user.id } });
        if (!s) return res.status(401).json({ error: 'Student session is not valid' });

        const canonicalStudentBranch = staffScopeService.canonicalizeBranch(s.branch);
        const branchAliases = staffScopeService.getRawAliasesForCanonicals([canonicalStudentBranch]);
        const yearAliases = getYearAliases(s.year, s.academicYear);
        const semAliases = getSemesterAliases(s.semester);

        const q = String(req.query.q || '').trim();
        const and = [
            { OR: [{ branch: null }, { branch: { in: branchAliases } }] },
            { OR: [{ semester: null }, { semester: { in: semAliases } }] },
            { OR: [{ section: null }, { section: s.section }] },
            { OR: [{ academicYear: null }, { academicYear: { in: yearAliases } }] }
        ];

        if (q) {
            and.push({
                OR: [
                    { title: { contains: q, mode: 'insensitive' } },
                    { subject: { contains: q, mode: 'insensitive' } },
                    { category: { contains: q, mode: 'insensitive' } }
                ]
            });
        }

        if (req.query.subject)  and.push({ subject: String(req.query.subject) });
        if (req.query.category) and.push({ category: String(req.query.category).toUpperCase() });

        const materials = await prisma.libraryMaterial.findMany({
            where: {
                isActive: true,
                OR: [
                    { expiresAt: null },
                    { expiresAt: { gt: new Date() } }
                ],
                AND: and
            },
            orderBy: { createdAt: 'desc' }
        });

        res.json(materials);
    } catch (e) {
        next(e);
    }
}

async function adminList(req, res, next) {
    try {
        const where = {};
        if (req.query.q) {
            where.OR = [
                { title: { contains: String(req.query.q), mode: 'insensitive' } },
                { subject: { contains: String(req.query.q), mode: 'insensitive' } }
            ];
        }

        // Apply StaffScope filtering for HODs / Faculty if restricted
        const admin = req.admin;
        if (admin && admin.role === 'HOD') {
            const { rawAliases } = await staffScopeService.getAuthorizedDepartments(admin);
            where.OR = [
                { branch: null },
                { branch: { in: rawAliases } }
            ];
        }

        res.json(await prisma.libraryMaterial.findMany({ where, orderBy: { createdAt: 'desc' } }));
    } catch (e) {
        next(e);
    }
}

async function update(req, res, next) {
    try {
        const d = data(req.body);
        if (!d.title) delete d.title;
        res.json({ success: true, material: await prisma.libraryMaterial.update({ where: { id: req.params.id }, data: d }) });
    } catch (e) {
        next(e);
    }
}

async function archive(req, res, next) {
    try {
        res.json({ success: true, material: await prisma.libraryMaterial.update({ where: { id: req.params.id }, data: { isActive: false } }) });
    } catch (e) {
        next(e);
    }
}

async function del(req, res, next) {
    try {
        const m = await prisma.libraryMaterial.delete({ where: { id: req.params.id } });
        await storage.remove(m.fileName);
        res.json({ success: true });
    } catch (e) {
        next(e);
    }
}

async function replaceFile(req, res, next) {
    try {
        if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'A file body is required.' });
        if (req.body.length > MAX_BYTES) return res.status(413).json({ error: 'File exceeds upload limit.' });

        const originalFileName = storage.safeName(req.headers['x-file-name']);
        const ext = storage.extension(originalFileName);
        if (!TYPES[ext]) return res.status(400).json({ error: 'Unsupported file extension.' });

        const detected = storage.detectType(req.body, ext);
        if (!detected) return res.status(400).json({ error: 'File signature does not match a supported academic file.' });

        const m = await prisma.libraryMaterial.findUnique({ where: { id: req.params.id } });
        if (!m) return res.status(404).json({ error: 'Material not found' });

        const stored = await storage.save(req.body, originalFileName);
        await storage.remove(m.fileName);

        const updated = await prisma.libraryMaterial.update({
            where: { id: m.id },
            data: {
                fileName: stored.fileName,
                originalFileName,
                fileType: ext.slice(1).toUpperCase(),
                mimeType: detected,
                fileSize: req.body.length
            }
        });

        res.json({ success: true, material: updated });
    } catch (e) {
        next(e);
    }
}

async function serve(req, res, next) {
    try {
        const m = await prisma.libraryMaterial.findUnique({ where: { id: req.params.id } });
        if (!m || !m.isActive) return res.status(404).json({ error: 'Material not found' });

        // Check expiration
        if (m.expiresAt && new Date(m.expiresAt) < new Date()) {
            return res.status(403).json({ error: 'Material has expired and is no longer accessible' });
        }

        const s = await prisma.student.findUnique({ where: { id: req.user.id } });
        if (!s || !allowed(m, s)) return res.status(403).json({ error: 'You are not authorized to access this material' });

        await prisma[req.query.download === 'true' ? 'libraryDownload' : 'libraryView'].upsert({
            where: { studentId_materialId: { studentId: s.id, materialId: m.id } },
            update: {},
            create: { studentId: s.id, materialId: m.id }
        });

        const file = storage.resolve(m.fileName);
        if (!fs.existsSync(file)) return res.status(404).json({ error: 'Stored file is unavailable' });

        res.type(m.mimeType);
        res.setHeader('Content-Disposition', `${req.query.download === 'true' ? 'attachment' : 'inline'}; filename="${m.originalFileName.replace(/[\r\n"]/g, '_')}"`);
        fs.createReadStream(file).on('error', next).pipe(res);
    } catch (e) {
        next(e);
    }
}

module.exports = {
    upload,
    studentList,
    adminList,
    update,
    archive,
    del,
    serve,
    replaceFile
};