package updater

import "testing"

func TestRegistrationLocationMatches(t *testing.T) {
	cases := []struct {
		location string
		install  string
		want     bool
	}{
		{`C:\ProgramData\EduWork\eduwork`, `C:\ProgramData\EduWork\eduwork`, true},
		{`C:\ProgramData\EduWork\eduwork\`, `c:\programdata\eduwork\eduwork`, true},
		{`C:\Other\EduWork`, `C:\ProgramData\EduWork\eduwork`, false},
		{``, `C:\ProgramData\EduWork\eduwork`, false},
		{`C:\ProgramData\EduWork\eduwork`, ``, false},
	}
	for _, c := range cases {
		if got := registrationLocationMatches(c.location, c.install); got != c.want {
			t.Errorf("registrationLocationMatches(%q, %q) = %v, want %v", c.location, c.install, got, c.want)
		}
	}
}
