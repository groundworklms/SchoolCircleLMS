// Parsed from real MCCES POI Combined Reports with a coordinate-aware PDF parser.
// Course structure, lesson IDs, hours, and objective counts are REAL.
// The `mastery` numbers are invented demo data over real annex names.

export const POIS = {
  // Prototype outline restored from the original TC course, not a parsed MCCES POI.
  "TC32209": {
    "courseId": "TC32209",
    "courseTitle": "Rifle Marksmanship — TC 3-22.9",
    "version": "1.0.0",
    "status": "ACTIVE",
    "school": "03xx — Infantry",
    "sourcePages": 296,
    "sourceDoc": "TC 3-22.9 Rifle Marksmanship.pdf",
    "totalLessons": 10,
    "totalHours": 64.0,
    "totalObjectives": 24,
    "annexes": [
      {
        "letter": "A",
        "title": "Ch 5 · Functional Elements",
        "hours": 12.0,
        "lessons": [
          { "id": "RM.05.01", "title": "Functional Elements of the Shot", "hours": 6.0, "kind": "lesson" },
          { "id": "RM.05.02", "title": "Weapon Handling & Safety", "hours": 6.0, "kind": "lesson" }
        ]
      },
      {
        "letter": "B",
        "title": "Ch 6 · Stability & Natural Point of Aim",
        "hours": 14.0,
        "lessons": [
          { "id": "RM.06.01", "title": "Building a Stable Firing Position", "hours": 8.0, "kind": "lesson" },
          { "id": "RM.06.02", "title": "Natural Point of Aim", "hours": 6.0, "kind": "lesson" }
        ]
      },
      {
        "letter": "C",
        "title": "Ch 7 · Aiming — Sight Alignment & Picture",
        "hours": 12.0,
        "lessons": [
          { "id": "RM.07.01", "title": "Sight Alignment & Sight Picture", "hours": 6.0, "kind": "lesson" },
          { "id": "RM.07.02", "title": "The Shot Process", "hours": 6.0, "kind": "lesson" }
        ]
      },
      {
        "letter": "D",
        "title": "Ch 8 · Trigger Control & Follow-Through",
        "hours": 14.0,
        "lessons": [
          { "id": "RM.08.01", "title": "Trigger Control", "hours": 8.0, "kind": "lesson" },
          { "id": "RM.08.02", "title": "Follow-Through & Calling the Shot", "hours": 6.0, "kind": "lesson" }
        ]
      },
      {
        "letter": "Z",
        "title": "Course Administration",
        "hours": 12.0,
        "lessons": [
          { "id": "RM.Z.01", "title": "Range Safety Brief", "hours": 6.0, "kind": "lesson" },
          { "id": "RM.Z.02", "title": "Qualification", "hours": 6.0, "kind": "exam" }
        ]
      }
    ]
  },
  "M092721": {
    "courseId": "M092721",
    "courseTitle": "Basic Electronics Course",
    "version": "7.0.0",
    "status": "HISTORICAL",
    "school": "28xx \u2014 Ground Electronics Maintenance",
    "sourcePages": 118,
    "sourceDoc": "Basic Electronics Course _7.0.0_POI Combined Report.pdf",
    "totalLessons": 52,
    "totalHours": 360.01,
    "totalObjectives": 116,
    "annexes": [
      {
        "letter": "A",
        "title": "DC Fundamentals",
        "hours": 86.0,
        "lessons": [
          {
            "id": "BE.01.01",
            "title": "Introduction to BEC",
            "hours": 5.0,
            "kind": "lesson"
          },
          {
            "id": "BE.01.02",
            "title": "ESD Safety",
            "hours": 4.0,
            "kind": "lesson"
          },
          {
            "id": "BE.01.03",
            "title": "DC Theory",
            "hours": 10.0,
            "kind": "lesson"
          },
          {
            "id": "BE.01.04",
            "title": "Switches",
            "hours": 10.0,
            "kind": "lesson"
          },
          {
            "id": "BE.01.05",
            "title": "Series Resistive Circuits",
            "hours": 11.0,
            "kind": "lesson"
          },
          {
            "id": "BE.01.06",
            "title": "Parallel Resistive Circuits",
            "hours": 11.0,
            "kind": "lesson"
          },
          {
            "id": "BE.01.07",
            "title": "Series/Parallel Resistive Circuits",
            "hours": 13.0,
            "kind": "lesson"
          },
          {
            "id": "BE.01.08",
            "title": "Potentiometers and Rheostats",
            "hours": 11.0,
            "kind": "lesson"
          },
          {
            "id": "BE.01.09",
            "title": "DC Fundamentals Written Exam",
            "hours": 5.0,
            "kind": "exam"
          },
          {
            "id": "BE.01.10",
            "title": "DC Fundamentals Performance Exam",
            "hours": 6.0,
            "kind": "exam"
          }
        ]
      },
      {
        "letter": "B",
        "title": "AC Fundamentals",
        "hours": 91.0,
        "lessons": [
          {
            "id": "BE.02.01",
            "title": "AC Theory",
            "hours": 7.0,
            "kind": "lesson"
          },
          {
            "id": "BE.02.02",
            "title": "Test Equipment",
            "hours": 10.0,
            "kind": "lesson"
          },
          {
            "id": "BE.02.03",
            "title": "Inductors",
            "hours": 14.0,
            "kind": "lesson"
          },
          {
            "id": "BE.02.04",
            "title": "Transformers",
            "hours": 10.0,
            "kind": "lesson"
          },
          {
            "id": "BE.02.05",
            "title": "Capacitors",
            "hours": 13.0,
            "kind": "lesson"
          },
          {
            "id": "BE.02.06",
            "title": "RLC Circuits",
            "hours": 16.0,
            "kind": "lesson"
          },
          {
            "id": "BE.02.07",
            "title": "Frequency Filters",
            "hours": 10.0,
            "kind": "lesson"
          },
          {
            "id": "BE.02.08",
            "title": "AC Fundamentals Written Exam",
            "hours": 5.0,
            "kind": "exam"
          },
          {
            "id": "BE.02.09",
            "title": "AC Fundamentals Performance Exam",
            "hours": 6.0,
            "kind": "exam"
          }
        ]
      },
      {
        "letter": "C",
        "title": "Power Supplies",
        "hours": 67.0,
        "lessons": [
          {
            "id": "BE.03.01",
            "title": "Semiconductor Theory",
            "hours": 5.0,
            "kind": "lesson"
          },
          {
            "id": "BE.03.02",
            "title": "Transistor Junctions and Biasing",
            "hours": 8.0,
            "kind": "lesson"
          },
          {
            "id": "BE.03.03",
            "title": "Transistor Load Lines & Gains",
            "hours": 4.0,
            "kind": "lesson"
          },
          {
            "id": "BE.03.04",
            "title": "Common Amplifiers",
            "hours": 6.0,
            "kind": "lesson"
          },
          {
            "id": "BE.03.05",
            "title": "Coupling",
            "hours": 5.0,
            "kind": "lesson"
          },
          {
            "id": "BE.03.06",
            "title": "Complementary Amplifier",
            "hours": 6.0,
            "kind": "lesson"
          },
          {
            "id": "BE.03.07",
            "title": "Introduction to Power Supplies",
            "hours": 3.0,
            "kind": "lesson"
          },
          {
            "id": "BE.03.08",
            "title": "Introduction to Rectifiers",
            "hours": 7.0,
            "kind": "lesson"
          },
          {
            "id": "BE.03.09",
            "title": "Introduction to Filters",
            "hours": 3.0,
            "kind": "lesson"
          },
          {
            "id": "BE.03.10",
            "title": "Instroduction to Regulators",
            "hours": 6.0,
            "kind": "lesson"
          },
          {
            "id": "BE.03.11",
            "title": "Troubleshooting Power Supplies",
            "hours": 8.0,
            "kind": "lesson"
          },
          {
            "id": "BE.03.12",
            "title": "Power Supplies Performance Exam",
            "hours": 2.0,
            "kind": "exam"
          },
          {
            "id": "BE.03.13",
            "title": "Power Supplies Written Exam",
            "hours": 4.0,
            "kind": "exam"
          }
        ]
      },
      {
        "letter": "D",
        "title": "Switching Regulator",
        "hours": 36.0,
        "lessons": [
          {
            "id": "BE.04.01",
            "title": "Introduction to Operational Amplifiers",
            "hours": 4.0,
            "kind": "lesson"
          },
          {
            "id": "BE.04.02",
            "title": "Logic Gates",
            "hours": 4.0,
            "kind": "lesson"
          },
          {
            "id": "BE.04.03",
            "title": "Flip Flops",
            "hours": 5.0,
            "kind": "lesson"
          },
          {
            "id": "BE.04.04",
            "title": "Introduction to Oscillators",
            "hours": 4.0,
            "kind": "lesson"
          },
          {
            "id": "BE.04.05",
            "title": "DC-to-DC Converters",
            "hours": 5.0,
            "kind": "lesson"
          },
          {
            "id": "BE.04.06",
            "title": "Troubleshooting DC-to-DC Converters",
            "hours": 8.0,
            "kind": "lesson"
          },
          {
            "id": "BE.04.07",
            "title": "Switching Regulator Performance Exam",
            "hours": 2.0,
            "kind": "exam"
          },
          {
            "id": "BE.04.08",
            "title": "Switching Regulator Written Exam",
            "hours": 4.0,
            "kind": "exam"
          }
        ]
      },
      {
        "letter": "E",
        "title": "Network Fundamentals",
        "hours": 25.0,
        "lessons": [
          {
            "id": "BE.05.01",
            "title": "Network Fundamentals",
            "hours": 5.0,
            "kind": "lesson"
          },
          {
            "id": "BE.05.02",
            "title": "Troubleshooting Network Systems",
            "hours": 8.5,
            "kind": "lesson"
          },
          {
            "id": "BE.05.03",
            "title": "Fabrication of CAT5 Connectors",
            "hours": 6.0,
            "kind": "lesson"
          },
          {
            "id": "BE.05.04",
            "title": "Network Fundamentals Performance Exam",
            "hours": 5.0,
            "kind": "exam"
          },
          {
            "id": "BE.05.05",
            "title": "Network fundamentals Written Exam",
            "hours": 0.5,
            "kind": "exam"
          }
        ]
      },
      {
        "letter": "F",
        "title": "Cable Termination",
        "hours": 10.0,
        "lessons": [
          {
            "id": "BE.06.01",
            "title": "Coaxial Cable Repair",
            "hours": 5.5,
            "kind": "lesson"
          },
          {
            "id": "BE.06.02",
            "title": "Cabling Performance Exam",
            "hours": 4.0,
            "kind": "exam"
          },
          {
            "id": "BE.06.03",
            "title": "Cabling Termination Wrtten Exam",
            "hours": 0.5,
            "kind": "exam"
          }
        ]
      },
      {
        "letter": "Z",
        "title": "Administrative",
        "hours": 45.01,
        "lessons": [
          {
            "id": "BE.26.01",
            "title": "Administrative time",
            "hours": 42.0,
            "kind": "lesson"
          },
          {
            "id": "BE.26.02",
            "title": "Physical Training",
            "hours": 0.01,
            "kind": "lesson"
          },
          {
            "id": "BE.26.03",
            "title": "End of Course Critique",
            "hours": 1.0,
            "kind": "lesson"
          },
          {
            "id": "BE.26.04",
            "title": "BEC Graduation",
            "hours": 2.0,
            "kind": "lesson"
          }
        ]
      }
    ],
    "mastery": [
      {
        "letter": "A",
        "title": "DC Fundamentals",
        "mastery": 95
      },
      {
        "letter": "B",
        "title": "AC Fundamentals",
        "mastery": 78
      },
      {
        "letter": "C",
        "title": "Power Supplies",
        "mastery": 62
      },
      {
        "letter": "D",
        "title": "Switching Regulator",
        "mastery": 71
      },
      {
        "letter": "E",
        "title": "Network Fundamentals",
        "mastery": 88
      },
      {
        "letter": "F",
        "title": "Cable Termination",
        "mastery": 84
      }
    ]
  },
  "M09CVS1": {
    "courseId": "M09CVS1",
    "courseTitle": "Network Administrator Course",
    "version": "2023",
    "status": "APPROVED",
    "school": "06xx \u2014 Communications (MOS 0631)",
    "sourcePages": 90,
    "sourceDoc": "Network Administrator Course_2023_POI Combined Report.pdf",
    "totalLessons": 35,
    "totalHours": 512.0,
    "totalObjectives": 166,
    "annexes": [
      {
        "letter": "A",
        "title": "Network Fundamentals",
        "hours": 62.0,
        "lessons": [
          {
            "id": "TI.01.01",
            "title": "Introductions To Networks",
            "hours": 13.0,
            "kind": "lesson"
          },
          {
            "id": "TI.01.02",
            "title": "Addressing",
            "hours": 19.0,
            "kind": "lesson"
          },
          {
            "id": "TI.01.03",
            "title": "Network Hardware",
            "hours": 12.0,
            "kind": "lesson"
          },
          {
            "id": "TI.01.04",
            "title": "Types of Media",
            "hours": 12.0,
            "kind": "lesson"
          },
          {
            "id": "TI.01.05",
            "title": "NIC Configuration",
            "hours": 4.0,
            "kind": "lesson"
          },
          {
            "id": "TI.01.06",
            "title": "Network Documentation",
            "hours": 2.0,
            "kind": "lesson"
          }
        ]
      },
      {
        "letter": "B",
        "title": "Configuring Networks",
        "hours": 247.0,
        "lessons": [
          {
            "id": "TI.02.01",
            "title": "Basic Configurations",
            "hours": 28.0,
            "kind": "lesson"
          },
          {
            "id": "TI.02.02",
            "title": "VLANs-Port Configurations",
            "hours": 42.0,
            "kind": "lesson"
          },
          {
            "id": "TI.02.03",
            "title": "Basic Routing",
            "hours": 28.0,
            "kind": "lesson"
          },
          {
            "id": "TI.02.04",
            "title": "Static Routing",
            "hours": 28.0,
            "kind": "lesson"
          },
          {
            "id": "TI.02.05",
            "title": "Dynamic routing",
            "hours": 42.0,
            "kind": "lesson"
          },
          {
            "id": "TI.02.06",
            "title": "Tunneling",
            "hours": 32.0,
            "kind": "lesson"
          },
          {
            "id": "TI.02.07",
            "title": "Virtual Routing and Forwarding",
            "hours": 28.0,
            "kind": "lesson"
          },
          {
            "id": "TI.02.08",
            "title": "Backup Procedures",
            "hours": 19.0,
            "kind": "lesson"
          }
        ]
      },
      {
        "letter": "C",
        "title": "Network Security",
        "hours": 85.0,
        "lessons": [
          {
            "id": "TI.03.01",
            "title": "Cyber Security",
            "hours": 5.0,
            "kind": "lesson"
          },
          {
            "id": "TI.03.02",
            "title": "Encryption Devices",
            "hours": 29.0,
            "kind": "lesson"
          },
          {
            "id": "TI.03.03",
            "title": "Device Hardening",
            "hours": 19.0,
            "kind": "lesson"
          },
          {
            "id": "TI.03.04",
            "title": "Access Control List",
            "hours": 19.0,
            "kind": "lesson"
          },
          {
            "id": "TI.03.05",
            "title": "Network Monitoring",
            "hours": 13.0,
            "kind": "lesson"
          }
        ]
      },
      {
        "letter": "D",
        "title": "Network Maintenance",
        "hours": 30.0,
        "lessons": [
          {
            "id": "TI.04.01",
            "title": "Preventive Maintenance",
            "hours": 10.0,
            "kind": "lesson"
          },
          {
            "id": "TI.04.02",
            "title": "Network Backups and Upgrades",
            "hours": 10.0,
            "kind": "lesson"
          },
          {
            "id": "TI.04.03",
            "title": "Network Monitoring",
            "hours": 10.0,
            "kind": "lesson"
          }
        ]
      },
      {
        "letter": "E",
        "title": "Naval Inegration",
        "hours": 0,
        "lessons": []
      },
      {
        "letter": "X",
        "title": "Exams",
        "hours": 24.0,
        "lessons": [
          {
            "id": "TI.24.01",
            "title": "Network Fundamentals (Written Exam)",
            "hours": 2.0,
            "kind": "exam"
          },
          {
            "id": "TI.24.02",
            "title": "Network Fundamentals (Performance Exam)",
            "hours": 6.0,
            "kind": "exam"
          },
          {
            "id": "TI.24.03",
            "title": "Configuring Networks (Written Exam)",
            "hours": 6.0,
            "kind": "exam"
          },
          {
            "id": "TI.24.04",
            "title": "Configuring Networks (Practical Exams)",
            "hours": 3.0,
            "kind": "exam"
          },
          {
            "id": "TI.24.05",
            "title": "Network Security (Written Exam)",
            "hours": 1.0,
            "kind": "exam"
          },
          {
            "id": "TI.24.06",
            "title": "Network Security (Performance Exam)",
            "hours": 3.0,
            "kind": "exam"
          },
          {
            "id": "TI.24.07",
            "title": "Network Maintenance (Written Exam)",
            "hours": 1.0,
            "kind": "exam"
          },
          {
            "id": "TI.24.08",
            "title": "Network Maintenance (Performance Exam)",
            "hours": 2.0,
            "kind": "exam"
          }
        ]
      },
      {
        "letter": "Z",
        "title": "Administrative",
        "hours": 64.0,
        "lessons": [
          {
            "id": "TI.26.01",
            "title": "Check In",
            "hours": 8.0,
            "kind": "lesson"
          },
          {
            "id": "TI.26.02",
            "title": "Check Out",
            "hours": 8.0,
            "kind": "lesson"
          },
          {
            "id": "TI.26.03",
            "title": "End Of Course Critique",
            "hours": 1.0,
            "kind": "lesson"
          },
          {
            "id": "TI.26.04",
            "title": "Graduation",
            "hours": 3.0,
            "kind": "lesson"
          },
          {
            "id": "TI.26.05",
            "title": "Required Administrative Action",
            "hours": 44.0,
            "kind": "lesson"
          }
        ]
      }
    ],
    "mastery": [
      {
        "letter": "A",
        "title": "Network Fundamentals",
        "mastery": 86
      },
      {
        "letter": "B",
        "title": "Configuring Networks",
        "mastery": 58
      },
      {
        "letter": "C",
        "title": "Network Security",
        "mastery": 74
      },
      {
        "letter": "D",
        "title": "Network Maintenance",
        "mastery": 81
      },
      {
        "letter": "X",
        "title": "Exams",
        "mastery": 69
      }
    ]
  }
};

export const POI = POIS['M092721'];
