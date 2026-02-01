const pool = require('./src/db');

// Simulate the PDF generation
async function testPdfGeneration() {
  try {
    console.log('Testing PDF generation...\n');

    // Simulate calling computeAbsenceNoticeCandidates
    const [activeDaysRows] = await pool.execute(
      'SELECT id FROM timetable_days WHERE Is_active = 1 ORDER BY id'
    );
    const activeDayIds = new Set(activeDaysRows.map(r => Number(r.id)));
    console.log('Active day IDs:', Array.from(activeDayIds).sort().join(', '));

    // Check if we can call the actual controller function
    const absencesController = require('./src/controllers/absencesController');
    
    // Mock request and response objects
    const mockReq = {
      body: {
        date: '2026-01-24',
        section: null,
        min_days: 7,
        include_inactive: 0,
        stage: 0,
        student_ids: null
      },
      query: {}
    };

    const mockRes = {
      status: function(code) {
        console.log(`Response status: ${code}`);
        return this;
      },
      json: function(data) {
        console.log('Response JSON:', data);
      },
      setHeader: function(key, value) {
        // Silent
      },
      end: function(buffer) {
        console.log(`✓ PDF generated: ${buffer?.length || 0} bytes`);
      }
    };

    console.log('\nCalling getAbsenceNoticesPdf...');
    await absencesController.getAbsenceNoticesPdf(mockReq, mockRes);
    
    console.log('\n✓ Test completed');
  } catch (err) {
    console.error('✗ Error:', err.message);
    console.error(err.stack);
  } finally {
    await pool.end();
  }
}

testPdfGeneration();
