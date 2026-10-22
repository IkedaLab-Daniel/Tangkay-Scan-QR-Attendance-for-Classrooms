export const openApiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'TangkayScan API',
    version: '1.0.0',
    description:
      'Backend REST API for TangkayScan — a QR attendance and classroom management system featuring rolling dynamic QR codes, anti-spoofing risk scoring, offline verification codes, and automated parent notifications.',
    contact: {
      name: 'TangkayScan Support',
      email: 'support@tangkayscan.local',
    },
  },
  servers: [
    {
      url: '/',
      description: 'Current environment server',
    },
  ],
  tags: [
    { name: 'System', description: 'System health and uptime checks' },
    { name: 'Teacher Auth', description: 'Teacher signup, login, refresh, and profile management' },
    { name: 'Student Auth', description: 'Student magic-link and code authentication' },
    { name: 'Rooms', description: 'Classroom room setup, policies, and configuration' },
    {
      name: 'Room Members & Officers',
      description: 'Roster enrollment, officer designations, and student consent',
    },
    { name: 'Sessions', description: 'Live dynamic QR & static QR attendance session lifecycle' },
    { name: 'Attendance & Scans', description: 'QR scanning, risk evaluation, and offline codes' },
    {
      name: 'Manual Attendance',
      description: 'Manual attendance dispute requests and review workflows',
    },
    { name: 'Dashboard & Reports', description: 'Attendance logs, statistics, and CSV exports' },
    {
      name: 'Backgrounds & Presets',
      description: 'Classroom display background presets and custom image uploads',
    },
    { name: 'Student Portal', description: 'Student attendance history and personal streaks' },
    { name: 'Uploads', description: 'Protected selfie and manual verification asset serving' },
  ],
  components: {
    securitySchemes: {
      CookieAuth: {
        type: 'apiKey',
        in: 'cookie',
        name: 'access_token',
        description: 'HTTP-only JWT access token set on authentication (15m validity).',
      },
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Optional Bearer token for programmatic integrations.',
      },
    },
    schemas: {
      ErrorResponse: {
        type: 'object',
        properties: {
          error: { type: 'string' },
          details: { type: 'object', nullable: true },
        },
        required: ['error'],
      },
      TeacherProfile: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          email: { type: 'string', format: 'email' },
          plan: { type: 'string', example: 'free' },
          created_at: { type: 'string', format: 'date-time' },
          typ: { type: 'string', enum: ['teacher'] },
        },
        required: ['id', 'name', 'email'],
      },
      StudentProfile: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          email: { type: 'string', format: 'email' },
          parent_email: { type: 'string', format: 'email', nullable: true },
          consent_status: { type: 'string', enum: ['unprompted', 'granted', 'denied'] },
          created_at: { type: 'string', format: 'date-time' },
          typ: { type: 'string', enum: ['student'] },
        },
        required: ['id', 'name', 'email'],
      },
      Room: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          attendance_mode: { type: 'string', enum: ['strict', 'balanced', 'static', 'manual'] },
          geofence_radius_m: { type: 'integer' },
          gps_policy: { type: 'string', enum: ['off', 'warn', 'reject'] },
          selfie_policy: { type: 'string', enum: ['off', 'optional', 'required'] },
          require_manual_approval: { type: 'boolean' },
          anchor_lat: { type: 'number', nullable: true },
          anchor_lng: { type: 'number', nullable: true },
          invite_code: { type: 'string' },
          background_type: { type: 'string', enum: ['none', 'preset', 'custom'] },
          background_preset_id: { type: 'string', nullable: true },
          background_image_path: { type: 'string', nullable: true },
          background_placeholder: { type: 'string', nullable: true },
          background_dim: { type: 'integer' },
          background_blur: { type: 'integer' },
          background_scrim: { type: 'string', enum: ['light', 'dark'] },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      AttendanceSession: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          room_id: { type: 'string' },
          status: { type: 'string', enum: ['active', 'ended'] },
          started_at: { type: 'string', format: 'date-time' },
          ended_at: { type: 'string', format: 'date-time', nullable: true },
          origin_lat: { type: 'number', nullable: true },
          origin_lng: { type: 'number', nullable: true },
          origin_accuracy: { type: 'number', nullable: true },
        },
      },
      AttendanceRecord: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          session_id: { type: 'string' },
          student_id: { type: 'string' },
          method: { type: 'string', enum: ['scan', 'manual', 'offline'] },
          approval_status: { type: 'string', enum: ['approved', 'pending', 'rejected'] },
          location_flag: {
            type: 'string',
            enum: ['verified', 'unverified', 'mismatch', 'disabled'],
          },
          risk_score: { type: 'string', enum: ['low', 'medium', 'high'] },
          risk_signals: { type: 'object', nullable: true },
          selfie_url: { type: 'string', nullable: true },
          distance_from_origin_m: { type: 'number', nullable: true },
          scanned_at: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
  paths: {
    '/health': {
      get: {
        tags: ['System'],
        summary: 'Server health check',
        description: 'Returns health status and current server timestamp.',
        responses: {
          '200': {
            description: 'Server is healthy',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'ok' },
                    timestamp: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/auth/teacher/signup': {
      post: {
        tags: ['Teacher Auth'],
        summary: 'Register a new teacher',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string', minLength: 2, example: 'Maria Santos' },
                  email: { type: 'string', format: 'email', example: 'maria@school.edu' },
                  password: { type: 'string', minLength: 8, example: 'SecurePassword123!' },
                },
                required: ['name', 'email', 'password'],
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Teacher created successfully. Sets access and refresh cookies.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                    email: { type: 'string' },
                  },
                },
              },
            },
          },
          '400': {
            description: 'Validation failed',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
            },
          },
          '409': {
            description: 'Email already registered',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
            },
          },
        },
      },
    },
    '/api/auth/teacher/login': {
      post: {
        tags: ['Teacher Auth'],
        summary: 'Log in as a teacher',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string' },
                },
                required: ['email', 'password'],
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Login successful. Sets authentication cookies.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                    email: { type: 'string' },
                  },
                },
              },
            },
          },
          '401': { description: 'Invalid credentials' },
          '429': { description: 'Rate limit exceeded' },
        },
      },
    },
    '/api/auth/teacher/refresh': {
      post: {
        tags: ['Teacher Auth'],
        summary: 'Refresh teacher access token',
        description: 'Uses the HTTP-only refresh_token cookie to issue a new access_token.',
        responses: {
          '200': {
            description: 'Token refreshed',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { ok: { type: 'boolean' } } },
              },
            },
          },
          '401': { description: 'Invalid or expired refresh token' },
        },
      },
    },
    '/api/auth/logout': {
      post: {
        tags: ['Teacher Auth', 'Student Auth'],
        summary: 'Log out current session',
        description: 'Revokes refresh token in database and clears authentication cookies.',
        responses: {
          '200': {
            description: 'Logged out successfully',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { ok: { type: 'boolean' } } },
              },
            },
          },
        },
      },
    },
    '/api/auth/me': {
      get: {
        tags: ['Teacher Auth', 'Student Auth'],
        summary: 'Get current authenticated user profile',
        security: [{ CookieAuth: [] }],
        responses: {
          '200': {
            description: 'Current user profile (either Teacher or Student)',
            content: {
              'application/json': {
                schema: {
                  oneOf: [
                    { $ref: '#/components/schemas/TeacherProfile' },
                    { $ref: '#/components/schemas/StudentProfile' },
                  ],
                },
              },
            },
          },
          '401': { description: 'Unauthorized' },
        },
      },
    },
    '/api/auth/student/request-link': {
      post: {
        tags: ['Student Auth'],
        summary: 'Request student magic-link login',
        description:
          'Generates a one-time login token and sends an email to the student with an authorization link.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string', minLength: 2 },
                  email: { type: 'string', format: 'email' },
                  inviteCode: { type: 'string' },
                },
                required: ['name', 'email', 'inviteCode'],
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Link enqueued for delivery',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { message: { type: 'string' } } },
              },
            },
          },
          '404': { description: 'Invalid invite code' },
          '429': { description: 'Rate limit exceeded' },
        },
      },
    },
    '/api/auth/student/verify/{token}': {
      get: {
        tags: ['Student Auth'],
        summary: 'Verify magic-link token',
        parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'Authentication successful. Sets student auth cookies.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    student: { $ref: '#/components/schemas/StudentProfile' },
                  },
                },
              },
            },
          },
          '400': { description: 'Invalid or expired magic link' },
        },
      },
    },
    '/api/auth/student/verify-code': {
      post: {
        tags: ['Student Auth'],
        summary: 'Verify 6-digit offline join code',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  joinCode: { type: 'string', minLength: 6, maxLength: 6 },
                  inviteCode: { type: 'string' },
                },
                required: ['joinCode', 'inviteCode'],
              },
            },
          },
        },
        responses: {
          '200': { description: 'Authentication successful' },
          '401': { description: 'Invalid or expired code' },
          '404': { description: 'Invalid invite code' },
        },
      },
    },
    '/api/auth/student/me': {
      get: {
        tags: ['Student Auth'],
        summary: 'Get authenticated student profile',
        security: [{ CookieAuth: [] }],
        responses: {
          '200': {
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/StudentProfile' } },
            },
          },
          '401': { description: 'Unauthorized' },
        },
      },
    },
    '/api/auth/student/refresh': {
      post: {
        tags: ['Student Auth'],
        summary: 'Refresh student access token',
        responses: {
          '200': {
            content: {
              'application/json': {
                schema: { type: 'object', properties: { ok: { type: 'boolean' } } },
              },
            },
          },
          '401': { description: 'Unauthorized or expired' },
        },
      },
    },
    '/api/auth/student/logout': {
      post: {
        tags: ['Student Auth'],
        summary: 'Student logout',
        responses: {
          '200': {
            content: {
              'application/json': {
                schema: { type: 'object', properties: { ok: { type: 'boolean' } } },
              },
            },
          },
        },
      },
    },
    '/api/rooms': {
      get: {
        tags: ['Rooms'],
        summary: 'List rooms for teacher',
        security: [{ CookieAuth: [] }],
        responses: {
          '200': {
            description: 'Array of teacher rooms',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/Room' } },
              },
            },
          },
        },
      },
      post: {
        tags: ['Rooms'],
        summary: 'Create a new classroom room',
        security: [{ CookieAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string', minLength: 2, maxLength: 100 },
                  attendance_mode: {
                    type: 'string',
                    enum: ['strict', 'balanced', 'static', 'manual'],
                  },
                  geofence_radius_m: { type: 'integer', minimum: 10, maximum: 2000, default: 50 },
                  gps_policy: { type: 'string', enum: ['off', 'warn', 'reject'] },
                  selfie_policy: { type: 'string', enum: ['off', 'optional', 'required'] },
                  require_manual_approval: { type: 'boolean' },
                  anchor_lat: { type: 'number' },
                  anchor_lng: { type: 'number' },
                },
                required: ['name', 'attendance_mode'],
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Room created',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Room' } } },
          },
        },
      },
    },
    '/api/rooms/my-rooms': {
      get: {
        tags: ['Rooms'],
        summary: 'List rooms enrolled by student',
        security: [{ CookieAuth: [] }],
        responses: {
          '200': { description: 'Enrolled rooms list' },
        },
      },
    },
    '/api/rooms/my-officer-rooms': {
      get: {
        tags: ['Rooms', 'Room Members & Officers'],
        summary: 'List rooms where student is designated as an officer',
        security: [{ CookieAuth: [] }],
        responses: {
          '200': { description: 'Officer rooms list' },
        },
      },
    },
    '/api/rooms/join/{inviteCode}': {
      get: {
        tags: ['Rooms'],
        summary: 'Public preview of room invite code',
        parameters: [
          { name: 'inviteCode', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Room information for student invite preview',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    roomId: { type: 'string' },
                    roomName: { type: 'string' },
                    teacherName: { type: 'string' },
                  },
                },
              },
            },
          },
          '404': { description: 'Invalid invite code' },
        },
      },
    },
    '/api/rooms/{id}': {
      get: {
        tags: ['Rooms'],
        summary: 'Get room details',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        security: [{ CookieAuth: [] }],
        responses: {
          '200': {
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Room' } } },
          },
          '404': { description: 'Room not found' },
        },
      },
      patch: {
        tags: ['Rooms'],
        summary: 'Update room settings and background',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        security: [{ CookieAuth: [] }],
        responses: {
          '200': { description: 'Room updated' },
        },
      },
      delete: {
        tags: ['Rooms'],
        summary: 'Delete room',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        security: [{ CookieAuth: [] }],
        responses: {
          '200': { description: 'Room deleted' },
        },
      },
    },
    '/api/rooms/{id}/join': {
      post: {
        tags: ['Room Members & Officers'],
        summary: 'Student enrolls in room',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        security: [{ CookieAuth: [] }],
        responses: {
          '201': { description: 'Joined room successfully' },
          '409': { description: 'Already a member' },
        },
      },
    },
    '/api/rooms/{id}/consent': {
      post: {
        tags: ['Room Members & Officers'],
        summary: 'Submit geolocation and biometric consent status',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        security: [{ CookieAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: { type: 'string', enum: ['granted', 'denied'] },
                },
                required: ['status'],
              },
            },
          },
        },
        responses: {
          '200': { description: 'Consent recorded' },
        },
      },
    },
    '/api/rooms/{id}/officers': {
      post: {
        tags: ['Room Members & Officers'],
        summary: 'Assign officer role to a student member',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        security: [{ CookieAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  memberId: { type: 'string' },
                  officerTitle: { type: 'string', example: 'Class President' },
                },
                required: ['memberId', 'officerTitle'],
              },
            },
          },
        },
        responses: {
          '200': { description: 'Officer assigned' },
        },
      },
    },
    '/api/rooms/{id}/officers/{memberId}': {
      delete: {
        tags: ['Room Members & Officers'],
        summary: 'Revoke officer role from member',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'memberId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        security: [{ CookieAuth: [] }],
        responses: {
          '200': { description: 'Officer role revoked' },
        },
      },
    },
    '/api/rooms/{id}/join-codes': {
      get: {
        tags: ['Rooms'],
        summary: 'List active offline join codes',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        security: [{ CookieAuth: [] }],
        responses: {
          '200': { description: 'List of active join codes' },
        },
      },
      post: {
        tags: ['Rooms'],
        summary: 'Generate a 6-digit join code for a student',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        security: [{ CookieAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  studentName: { type: 'string' },
                  studentEmail: { type: 'string', format: 'email' },
                },
                required: ['studentName', 'studentEmail'],
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Join code generated',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    joinCode: { type: 'string', example: '582910' },
                    studentId: { type: 'string' },
                    expiresAt: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/rooms/{id}/members': {
      get: {
        tags: ['Rooms', 'Room Members & Officers'],
        summary: 'List enrolled room members',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        security: [{ CookieAuth: [] }],
        responses: {
          '200': { description: 'List of room members and roles' },
        },
      },
    },
    '/api/rooms/{id}/static-qr': {
      get: {
        tags: ['Rooms', 'Sessions'],
        summary: 'Get static QR code image or token for classroom',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        security: [{ CookieAuth: [] }],
        responses: {
          '200': { description: 'Static QR code payload' },
        },
      },
    },
    '/api/rooms/{id}/static-session/start': {
      post: {
        tags: ['Sessions'],
        summary: 'Start an attendance session using the static QR code',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        security: [{ CookieAuth: [] }],
        responses: {
          '201': {
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/AttendanceSession' } },
            },
          },
        },
      },
    },
    '/api/rooms/{id}/static-session/close': {
      post: {
        tags: ['Sessions'],
        summary: 'End active static QR session',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        security: [{ CookieAuth: [] }],
        responses: {
          '200': { description: 'Session ended' },
        },
      },
    },
    '/api/sessions': {
      post: {
        tags: ['Sessions'],
        summary: 'Start a live rolling QR attendance session',
        security: [{ CookieAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  roomId: { type: 'string' },
                  originLat: { type: 'number' },
                  originLng: { type: 'number' },
                  originAccuracy: { type: 'number' },
                },
                required: ['roomId'],
              },
            },
          },
        },
        responses: {
          '201': {
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/AttendanceSession' } },
            },
          },
        },
      },
    },
    '/api/sessions/recent': {
      get: {
        tags: ['Sessions'],
        summary: 'Get recent attendance sessions across teacher rooms',
        security: [{ CookieAuth: [] }],
        responses: {
          '200': { description: 'Recent sessions list with summary counts' },
        },
      },
    },
    '/api/sessions/active': {
      get: {
        tags: ['Sessions'],
        summary: 'Check if there is an active session for student to scan into',
        parameters: [{ name: 'roomId', in: 'query', required: true, schema: { type: 'string' } }],
        security: [{ CookieAuth: [] }],
        responses: {
          '200': { description: 'Active session info or null' },
        },
      },
    },
    '/api/sessions/{id}': {
      get: {
        tags: ['Sessions'],
        summary: 'Get session details by ID',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        security: [{ CookieAuth: [] }],
        responses: {
          '200': {
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/AttendanceSession' } },
            },
          },
        },
      },
    },
    '/api/sessions/{id}/end': {
      post: {
        tags: ['Sessions'],
        summary: 'Close active session',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        security: [{ CookieAuth: [] }],
        responses: {
          '200': { description: 'Session marked ended' },
        },
      },
    },
    '/api/sessions/{id}/stream': {
      get: {
        tags: ['Sessions'],
        summary: 'Server-Sent Events (SSE) stream for rolling QR tokens and live scans',
        description: 'Pushes rotating QR tokens every 5 seconds to teacher projector display.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'text/event-stream stream',
            content: { 'text/event-stream': { schema: { type: 'string' } } },
          },
        },
      },
    },
    '/api/sessions/{id}/scan': {
      post: {
        tags: ['Attendance & Scans'],
        summary: 'Submit student attendance QR scan',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        security: [{ CookieAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  qr_token: { type: 'string', description: 'Decoded QR token string' },
                  student_lat: { type: 'number' },
                  student_lng: { type: 'number' },
                  student_accuracy: { type: 'number' },
                  device_fingerprint: { type: 'string' },
                  selfie: {
                    type: 'string',
                    description: 'Base64 image string for selfie verification',
                  },
                  offline_code: { type: 'string' },
                },
                required: ['qr_token'],
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Scan evaluated and attendance record recorded',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    record: { $ref: '#/components/schemas/AttendanceRecord' },
                  },
                },
              },
            },
          },
          '400': { description: 'Invalid or expired QR token / scan rejected' },
        },
      },
    },
    '/api/sessions/{id}/manual': {
      post: {
        tags: ['Manual Attendance'],
        summary: 'Submit manual attendance claim/request',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        security: [{ CookieAuth: [] }],
        responses: {
          '201': { description: 'Manual request created' },
        },
      },
    },
    '/api/sessions/{id}/manual/requests': {
      get: {
        tags: ['Manual Attendance'],
        summary: 'List manual attendance requests for teacher/officer review',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        security: [{ CookieAuth: [] }],
        responses: {
          '200': { description: 'Manual attendance requests' },
        },
      },
    },
    '/api/sessions/{id}/manual/requests/{requestId}': {
      patch: {
        tags: ['Manual Attendance'],
        summary: 'Review manual attendance request (approve or reject)',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'requestId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        security: [{ CookieAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: { type: 'string', enum: ['approved', 'rejected'] },
                },
                required: ['status'],
              },
            },
          },
        },
        responses: {
          '200': { description: 'Request updated' },
        },
      },
    },
    '/api/sessions/{id}/records': {
      get: {
        tags: ['Dashboard & Reports'],
        summary: 'Get attendance records for a session with filtering and pagination',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          {
            name: 'status',
            in: 'query',
            schema: { type: 'string', enum: ['approved', 'pending', 'rejected'] },
          },
        ],
        security: [{ CookieAuth: [] }],
        responses: {
          '200': { description: 'Paginated attendance records' },
        },
      },
    },
    '/api/rooms/{id}/sessions/{sessionId}/export': {
      get: {
        tags: ['Dashboard & Reports'],
        summary: 'Export session attendance to CSV',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'sessionId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        security: [{ CookieAuth: [] }],
        responses: {
          '200': {
            description: 'CSV attachment',
            content: { 'text/csv': { schema: { type: 'string' } } },
          },
        },
      },
    },
    '/api/presets': {
      get: {
        tags: ['Backgrounds & Presets'],
        summary: 'List available preset classroom backgrounds',
        responses: {
          '200': { description: 'List of presets' },
        },
      },
    },
    '/api/student/my-attendance-summary': {
      get: {
        tags: ['Student Portal'],
        summary: 'Student attendance stats and streak summary',
        security: [{ CookieAuth: [] }],
        responses: {
          '200': {
            description: 'Student summary',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    total: { type: 'integer' },
                    thisMonth: { type: 'integer' },
                    streak: { type: 'integer' },
                    recentRecords: { type: 'array', items: { type: 'object' } },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/student/my-attendance': {
      get: {
        tags: ['Student Portal'],
        summary: 'Student current week attendance logs',
        security: [{ CookieAuth: [] }],
        responses: {
          '200': { description: 'Attendance logs array' },
        },
      },
    },
  },
};
